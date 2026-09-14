import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DeviceConfigV1 } from "@albusforge/schema";
import { seedProvisioningFixture } from "../../gateway/src/provisioning.test-fixtures";
import { test, expect } from "./stack";

test.use({ enableProvisioning: true, trace: "off" }); // A trace must never retain the private download response.
test("self-flash registration → private configuration → firmware encoder upload → replacement → revocation", async ({ page, context, browser, stack }, testInfo) => {
  await testInfo.attach("provisioning-environment", { body: JSON.stringify({ source: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), startedAt: new Date().toISOString(), browser: browser.version(), mode: "Production Next + actual gateway auth/provisioning + Cloudlink HTTP + PostgreSQL16 + executed firmware C encoder. Accepted plan/profile/compiler record are synthetic software fixtures, not hardware approval. No physical board, Wi-Fi, paid provider or deployed writes." }, null, 2), contentType: "application/json" });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await context.route("**/*", route => new URL(route.request().url()).origin === stack.webUrl ? route.continue() : route.abort());
  await page.goto(`${stack.webUrl}/signin?next=%2Fsetup`);
  const email = "provisioning@example.test";
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await page.getByLabel("6-digit code").fill(await stack.codeFor(email));
  await page.getByRole("button", { name: "Verify & sign in", exact: true }).click();
  await expect(page).toHaveURL(`${stack.webUrl}/setup`);
  const owner = (await stack.pool.query("SELECT m.tenant_id,u.id FROM users.tenant_members m JOIN users.users u ON u.id=m.user_id WHERE u.email=$1", [email])).rows[0];
  const fixture = await seedProvisioningFixture(stack.pool, owner.tenant_id, owner.id);
  await page.goto(`${stack.webUrl}/setup?build=${fixture.buildId}&plan=1&code=1`);
  await page.getByRole("button", { name: "Register this device", exact: true }).click();
  await expect(page).toHaveURL(/\/setup\?device=[0-9a-f-]+$/);
  const download = async () => {
    const event = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download device configuration", exact: true }).click();
    const file = await event;
    const config = DeviceConfigV1.parse(JSON.parse(readFileSync((await file.path())!, "utf8")));
    await file.delete(); // Never preserve the secret in test artifacts.
    expect(await page.content()).not.toContain(config.token);
    return config;
  };
  const first = await download();
  expect(first.ingest_url).toBe(stack.ingestUrl);
  const directory = mkdtempSync(path.join(tmpdir(), "albus-encoder-browser-"));
  try {
    const root = path.resolve(import.meta.dirname, "../../..");
    const probe = path.join(directory, "encode");
    execFileSync("cc", ["-std=c11", "-Wall", "-Wextra", "-Werror", "-Ifirmware/esp32s3/main/include", "firmware/tools/encode.c", "firmware/esp32s3/main/hsx_wire.c", "-o", probe], { cwd: root });
    const upload = async (config: DeviceConfigV1, lux: number) => fetch(config.ingest_url, { method: "POST", headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" }, body: execFileSync(probe, [config.device_id, String(config.seq_start), String(Math.floor(Date.now() / 1000)), String(lux), "120"], { encoding: "utf8" }) });
    expect((await upload(first, 0)).status).toBe(202);
    await expect(page.getByRole("heading", { name: "Cloud reception confirmed", exact: true })).toBeVisible();
    await expect(page.getByText("0 lux", { exact: true })).toBeVisible();
    await page.getByLabel("I understand the previous configuration will stop working.").check();
    await page.getByRole("button", { name: "Replace configuration", exact: true }).click();
    await expect(page.getByRole("button", { name: "Download device configuration", exact: true })).toBeVisible();
    const second = await download();
    expect(second.device_id).toBe(first.device_id); expect(second.seq_start).toBe(first.seq_start + 1);
    expect((await upload(first, 0)).status).toBe(401);
    expect((await upload(second, 65535)).status).toBe(202);
    await page.getByRole("button", { name: "Check again", exact: true }).click();
    await expect(page.getByText("65535 lux", { exact: true })).toBeVisible();
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: testInfo.outputPath(`provisioning-${width}.png`), fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.getByText("Stop this identity’s uploads permanently", { exact: true }).click();
    await page.getByLabel("I want to revoke this device credential permanently.").check();
    await page.getByRole("button", { name: "Revoke device credential", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Device credential revoked", exact: true })).toBeVisible();
    expect((await upload(second, 65535)).status).toBe(401);
    expect(errors).toEqual([]);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
