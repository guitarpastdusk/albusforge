import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { buildApp as buildIngest } from "../../cloudlink/src/app";
import { test, expect } from "./stack";

test("existing registration → authenticated ingestion → first channel confirmation → revocation", async ({ page, context, browser, stack }, testInfo) => {
  await testInfo.attach("setup-environment", { body: JSON.stringify({ source: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), startedAt: new Date().toISOString(), browser: browser.version(), postgres: (await stack.pool.query("SHOW server_version")).rows[0].server_version, mode: "production Next + bundled gateway + actual Cloudlink HTTP handler + disposable PostgreSQL; synthetic existing registration; native local email sink; no physical device or firmware producer" }, null, 2), contentType: "application/json" });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await context.route("**/*", route => new URL(route.request().url()).origin === stack.webUrl ? route.continue() : route.abort());
  const id = randomUUID();
  const destination = `/setup?device=${id}`;
  await page.goto(`${stack.webUrl}${destination}`);
  await expect(page).toHaveURL(`${stack.webUrl}/signin?next=${encodeURIComponent(destination)}`);
  const email = "setup@example.test";
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await page.getByLabel("6-digit code").fill(await stack.codeFor(email));
  await page.getByRole("button", { name: "Verify & sign in", exact: true }).click();
  await expect(page).toHaveURL(`${stack.webUrl}${destination}`);
  await expect(page.getByRole("heading", { name: "Device unavailable", exact: true })).toBeVisible();
  const tenant = (await stack.pool.query("SELECT m.tenant_id FROM users.tenant_members m JOIN users.users u ON u.id=m.user_id WHERE u.email=$1", [email])).rows[0].tenant_id;
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  // Trusted provisioning is explicitly outside this journey. Seed only an existing identity;
  // all receipts/latest/raw rows below come from the real Cloudlink HTTP handler.
  await stack.pool.query("INSERT INTO telemetry.devices(id,tenant_id,token_hash,channels,source,next_s) VALUES($1,$2,$3,$4,$5,60)", [id, tenant, hash, { temperature: { unit: "C", min: -40, max: 85 }, humidity: { unit: "%", min: 0, max: 100 } }, { fixture: "private registration source" }]);
  const ingest = buildIngest({ pool: stack.pool, log: () => {} });
  try {
    const ingestUrl = await ingest.listen({ host: "127.0.0.1", port: 0 });
    const send = (seq: number, c: string, v: number, bearer = token) => {
      const ts = Math.floor(Date.now() / 1000);
      return fetch(`${ingestUrl}/ingest/v1`, { method: "POST", headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" }, body: JSON.stringify({ v: 1, dev: id, seq, ts, r: [{ c, v, t: ts - 60 }], st: { up_s: 120, health: [] } }) });
    };
    await page.reload();
    await expect(page.getByRole("heading", { name: "Waiting for an authenticated upload", exact: true })).toBeVisible();
    expect((await send(1, "temperature", 23, randomBytes(32).toString("base64url"))).status).toBe(401);
    await page.getByRole("button", { name: "Check again", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Waiting for an authenticated upload", exact: true })).toBeVisible();
    expect((await send(1, "temperature", 23)).status).toBe(202);
    // The visible waiting screen polls naturally; no manual reload proves progression.
    await expect(page.getByRole("heading", { name: "Upload received · some channels are waiting", exact: true })).toBeVisible();
    await expect(page.getByText("23 C", { exact: true })).toBeVisible();
    expect((await send(2, "humidity", 0)).status).toBe(202);
    await expect(page.getByRole("heading", { name: "Cloud reception confirmed", exact: true })).toBeVisible();
    await expect(page.getByText("0 %", { exact: true })).toBeVisible();
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: testInfo.outputPath(`setup-confirmed-${width}.png`), fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    const html = await page.content();
    for (const privateValue of [token, hash, "private registration source"]) expect(html).not.toContain(privateValue);
    await stack.pool.query("UPDATE telemetry.devices SET revoked_at=now() WHERE id=$1", [id]);
    await page.getByRole("button", { name: "Check again", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Device credential revoked", exact: true })).toBeVisible();
    expect((await send(3, "temperature", 24)).status).toBe(401);
    await page.getByRole("link", { name: "Open readings and history →", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Latest readings", exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await ingest.close(); }
});
