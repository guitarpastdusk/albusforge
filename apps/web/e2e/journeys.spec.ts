import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test, expect, type Stack } from "./stack";
import type { Page } from "@playwright/test";

async function verify(page: Page, stack: Stack, email: string) {
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByLabel("6-digit code")).toBeVisible();
  await page.getByLabel("6-digit code").fill(await stack.codeFor(email));
  await page.getByRole("button", { name: /Verify & (sign in|create account)/ }).click();
}

test("anonymous build → real email-code claim → project/Usage/telemetry → tenant isolation → sign out", async ({ page, context, browser, stack }, testInfo) => {
  await testInfo.attach("acceptance-environment", {
    body: JSON.stringify({
      source: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      startedAt: new Date().toISOString(), node: process.version, browser: browser.version(),
      postgres: (await stack.pool.query("SHOW server_version")).rows[0].server_version,
      mode: "production Next + bundled gateway + disposable PostgreSQL; local email sink and deterministic intake fixture",
    }, null, 2), contentType: "application/json",
  });
  expect((await stack.pool.query("SELECT current_user AS role")).rows[0].role).toBe("albus_app");
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  // Browser assets/navigation may only touch our local web service.
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    return url.origin === stack.webUrl ? route.continue() : route.abort();
  });
  await page.goto(stack.webUrl);
  await page.getByRole("textbox", { name: "Describe the device you want" }).fill("Browser acceptance greenhouse monitor");
  await page.getByRole("button", { name: "Start building" }).click();
  await expect(page).toHaveURL(/\/build\/[a-f0-9-]+$/);
  await expect(page.getByText("Fixture intake: your monitoring brief is saved.", { exact: true })).toBeVisible();
  const buildId = new URL(page.url()).pathname.split("/").at(-1)!;
  expect((await context.cookies()).some(cookie => cookie.name === "__Host-albus_anon")).toBe(true);
  const unclaimed = (await stack.pool.query("SELECT tenant_id,anon_owner_hash FROM builds.builds WHERE id=$1", [buildId])).rows[0];
  expect(unclaimed.tenant_id).toBeNull();
  expect(unclaimed.anon_owner_hash).toBeTruthy();

  await page.goto(`${stack.webUrl}/projects/${buildId}`);
  await expect(page).toHaveURL(new RegExp(`/signin\\?next=%2Fprojects%2F${buildId}$`));
  const email = "owner@example.test";
  await verify(page, stack, email);
  await expect(page).toHaveURL(`${stack.webUrl}/projects/${buildId}`);
  await expect(page.getByRole("heading", { name: "Shape your device" })).toBeVisible();
  const cookies = await context.cookies();
  expect(cookies.find(cookie => cookie.name === "__Host-albus_session")).toMatchObject({ secure: true, httpOnly: true, sameSite: "Lax", path: "/" });
  expect(cookies.some(cookie => cookie.name === "__Host-albus_anon")).toBe(false);
  const claimed = (await stack.pool.query("SELECT tenant_id,anon_owner_hash FROM builds.builds WHERE id=$1", [buildId])).rows[0];
  expect(claimed.tenant_id).toBeTruthy();
  expect(claimed.anon_owner_hash).toBeNull();
  expect((await stack.pool.query("SELECT tenant_id,anon_owner_hash FROM builds.llm_calls WHERE build_id=$1", [buildId])).rows).toEqual([{ tenant_id: claimed.tenant_id, anon_owner_hash: null }]);
  await page.screenshot({ path: testInfo.outputPath("claimed-project.png"), fullPage: true });
  await page.reload();
  await page.getByRole("link", { name: "Resume conversation →" }).click();
  await expect(page.getByText("Fixture intake: your monitoring brief is saved.", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Reply", exact: true }).fill("Use USB power");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("Fixture intake: your monitoring brief is saved.", { exact: true })).toHaveCount(2);
  await page.goto(`${stack.webUrl}/usage`);
  await expect(page.getByRole("heading", { name: "Usage", exact: true })).toBeVisible();
  await expect(page.getByText("$0.000246", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Build conversation", { exact: true })).toBeVisible();

  await page.screenshot({ path: testInfo.outputPath("usage.png"), fullPage: true });

  // Data fixture only: actual gateway auth/history queries and actual UI consume these rows.
  const deviceId = randomUUID();
  await stack.pool.query("INSERT INTO telemetry.devices(id,tenant_id,token_hash,channels,source,next_s) VALUES($1,$2,$3,$4,'{}',60)", [deviceId, claimed.tenant_id, randomUUID(), { temperature: { unit: "C", min: -40, max: 85 } }]);
  await stack.pool.query("INSERT INTO telemetry.readings(device_id,seq,ordinal,channel,ts,value) VALUES($1,1,0,'temperature',now()-interval '5 minutes',23.25)", [deviceId]);
  await stack.pool.query("INSERT INTO telemetry.latest(device_id,channel,ts,value,seq,ordinal) VALUES($1,'temperature',now()-interval '5 minutes',23.25,1,0)", [deviceId]);
  await page.goto(`${stack.webUrl}/live/${deviceId}`);
  await expect(page.getByRole("heading", { name: "Latest readings", exact: true })).toBeVisible();
  await expect(page.getByRole("listitem").getByText("23.25 C", { exact: true })).toBeVisible();
  await page.getByText("Inspect 1 samples", { exact: true }).click();
  await expect(page.getByRole("cell", { name: "23.25", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("telemetry.png"), fullPage: true });

  const stranger = await browser.newContext();
  try {
    await stranger.route("**/*", route => new URL(route.request().url()).origin === stack.webUrl ? route.continue() : route.abort());
    const other = await stranger.newPage();
    await other.goto(`${stack.webUrl}/signin?next=%2Fusage`);
    await verify(other, stack, "stranger@example.test");
    await expect(other).toHaveURL(`${stack.webUrl}/usage`);
    await expect(other.getByRole("heading", { name: "No model calls recorded this month", exact: true })).toBeVisible();
    const foreignBuild = await other.goto(`${stack.webUrl}/projects/${buildId}`);
    expect(foreignBuild?.status()).toBe(404);
    await other.goto(`${stack.webUrl}/live/${deviceId}`);
    // Next's loading boundary may already have streamed HTTP200 before notFound.
    // Assert the refusal UI and the underlying gateway's authoritative status.
    await expect(other.getByRole("heading", { name: "404", exact: true })).toBeVisible();
    await expect(other.getByText("23.25 C", { exact: true })).toHaveCount(0);
    const session = (await stranger.cookies()).find(cookie => cookie.name === "__Host-albus_session")!;
    const denied = await fetch(`${stack.gatewayUrl}/v1/telemetry/devices/${deviceId}`, { headers: { cookie: `${session.name}=${session.value}` } });
    expect(denied.status).toBe(404);
  } finally { await stranger.close(); }

  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect.poll(async () => (await context.cookies()).some(cookie => cookie.name === "__Host-albus_session")).toBe(false);
  for (const route of [`/projects/${buildId}`, "/usage", `/live/${deviceId}`]) {
    await page.goto(`${stack.webUrl}${route}`);
    await expect(page).toHaveURL(`${stack.webUrl}/signin?next=${encodeURIComponent(route)}`);
  }
  expect((await stack.pool.query("SELECT count(*)::int n FROM users.sessions s JOIN users.users u ON s.user_id=u.id WHERE u.email=$1 AND s.revoked_at IS NOT NULL", [email])).rows[0].n).toBe(1);
  expect(errors).toEqual([]);
});
