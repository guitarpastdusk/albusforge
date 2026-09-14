import { randomUUID } from "node:crypto";
import { test, expect } from "./stack";
import { syntheticPlanFixture } from "../../codegen/src/testing";
import { runOne } from "../../codegen/src/job";
import { localArtifacts } from "../../codegen/src/artifacts";
import {
  sha256,
  type CompileInput,
  type Compiled,
} from "../../codegen/src/compiler";
import { CANDIDATE, CHANNELS, renderApp } from "../../codegen/src/candidate";
import {
  FirmwareManifest,
  serializeFirmwareManifest,
} from "@albusforge/schema";
test.use({ enableFirmware: true });
async function fixtureCompile(input: CompileInput): Promise<Compiled> {
  const files = new Map(
    ["bootloader.bin", "partition-table.bin", "albusforge.bin"].map((name) => [
      name,
      Buffer.from("SYNTHETIC browser artifact " + name),
    ]),
  );
  const manifest = FirmwareManifest.parse({
    v: 1,
    build_id: input.build_id,
    plan_version: input.plan_version,
    code_version: input.code_version,
    profile_id: CANDIDATE,
    runtime: "0.1.0",
    channels: CHANNELS,
    files: [...files].map(([path, bytes]) => ({
      path,
      size: bytes.length,
      sha256: sha256(bytes),
    })),
    flash: { chip: "esp32s3", config_offset: 36864, config_size: 24576 },
  });
  const manifestBytes = serializeFirmwareManifest(manifest),
    source = renderApp(input.interval_s);
  return {
    manifest,
    manifestBytes,
    manifest_digest: sha256(manifestBytes),
    source,
    source_sha256: sha256(source),
    files,
    bundle: Buffer.from(
      "SYNTHETIC browser download fixture; not physical firmware",
    ),
    diagnostics:
      "Browser compiler fixture; actual pinned compiler is covered separately",
  };
}
test("firmware queue, edit diff, verified download and viewer refusal at 320 and 1440 px", async ({
  page,
  stack,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${stack.webUrl}/signin?next=%2Fprojects`);
  const email = "firmware-browser@example.test";
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await page.getByLabel("6-digit code").fill(await stack.codeFor(email));
  await page.getByRole("button", { name: "Verify & sign in" }).click();
  await expect(page).toHaveURL(`${stack.webUrl}/projects`);
  const identity = (
    await stack.pool.query(
      "SELECT u.id AS user,tm.tenant_id AS tenant FROM users.users u JOIN users.tenant_members tm ON tm.user_id=u.id WHERE u.email=$1",
      [email],
    )
  ).rows[0];
  const artifacts = localArtifacts(stack.artifactDir!);
  for (const width of [320, 1440]) {
    await stack.pool.query(
      "UPDATE users.tenant_members SET role='admin' WHERE user_id=$1",
      [identity.user],
    );
    const build = randomUUID(),
      { spec, parts, wiring, metadata } = syntheticPlanFixture();
    await stack.pool.query(
      "INSERT INTO builds.builds(id,tenant_id,ask_text) VALUES($1,$2,'SYNTHETIC firmware browser fixture')",
      [build, identity.tenant],
    );
    await stack.pool.query(
      "INSERT INTO builds.specs(build_id,version,data,confidence) VALUES($1,1,$2,1)",
      [build, spec],
    );
    await stack.pool.query(
      "INSERT INTO builds.plans(build_id,version,spec_version,part_versions,wiring_graph,power_budget,bom,solver_log,metadata,accepted_at,accepted_by) VALUES($1,1,1,$2,$3,$4,$5,'[]',$6,now(),$7)",
      [
        build,
        JSON.stringify(parts.map((p) => ({ id: p.id, version: p.version }))),
        wiring,
        {
          average_source_ma: 50,
          peak_source_ma: 400,
          peak_brain_rail_ma: 400,
          usable_capacity_mah: null,
          estimated_life_days: null,
        },
        JSON.stringify(
          parts.map((p) => ({
            part: { id: p.id, version: p.version },
            quantity: 1,
            unit_cost_usd: 10,
          })),
        ),
        metadata,
        identity.user,
      ],
    );
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`${stack.webUrl}/projects/${build}/firmware`);
    await page
      .getByRole("button", { name: "Compile firmware", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Version 1 · pending" }),
    ).toBeVisible();
    await runOne({ pool: stack.pool, artifacts, compile: fixtureCompile });
    await page.getByRole("button", { name: "Refresh firmware status" }).click();
    await expect(
      page.getByRole("heading", { name: "Version 1 · passed" }),
    ).toBeVisible();
    const downloadEvent = page.waitForEvent("download");
    await page
      .getByRole("link", { name: "Download firmware ZIP", exact: true })
      .click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe("firmware.zip");
    expect(await download.failure()).toBeNull();
    await page
      .getByLabel("Firmware edit instruction")
      .fill("Set interval to 120 seconds");
    await page.getByRole("button", { name: "Compile edited version" }).click();
    await expect(
      page.getByRole("heading", { name: "Version 2 · pending" }),
    ).toBeVisible();
    await runOne({ pool: stack.pool, artifacts, compile: fixtureCompile });
    await page.getByRole("button", { name: "Refresh firmware status" }).click();
    await expect(
      page.getByRole("heading", { name: "Version 2 · passed" }),
    ).toBeVisible();
    await page.getByText("Inspect SDK app and change", { exact: true }).click();
    await expect(
      page
        .getByText('extern "C" void app_main(void) { hsx_run(120); }', {
          exact: false,
        })
        .first(),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`firmware-${width}.png`),
      fullPage: true,
    });
    await stack.pool.query(
      "UPDATE users.tenant_members SET role='viewer' WHERE user_id=$1",
      [identity.user],
    );
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Compile edited version" }),
    ).toHaveCount(0);
    await expect(
      page.getByText("Operators and admins can request firmware changes.", {
        exact: false,
      }),
    ).toBeVisible();
  }
  expect(errors).toEqual([]);
});
