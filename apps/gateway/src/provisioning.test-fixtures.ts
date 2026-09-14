import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { BuildPlanMetadata, serializeBuildPlanInput, serializeFirmwareManifest, PartDefinition, type FirmwarePassedRecord } from "@albusforge/schema";
import { fixture, registryParts } from "../../matcher/src/fixtures";
import { solve } from "../../matcher/src/solver";
import { ProvisioningProfile } from "./provisioning-profile";

/** Synthetic accepted/compiled authority for software tests, never production evidence. */
export function provisioningFixtureModel() {
  const input = fixture(["read.illuminance_lux"]);
  const lux = registryParts().find(part => part.id === "V-005")!;
  input.parts.push(PartDefinition.parse({ ...lux, status: "active", name: "SYNTHETIC V-005",
    electrical: { ...lux.electrical, logic_v: [3.3, 3.3], voltage_range: [3.0, 5.5] },
    mechanical: { ...lux.mechanical, bounding_mm: [20, 10, 5], mount: { type: "cradle" } },
    commerce: { suppliers: [{ vendor: "adafruit", sku: "SYNTHETIC", url: "https://example.com/test" }], unit_cost_usd: 10 } }));
  if (lux.software.driver_pkg && lux.software.driver_version) input.compat.push({ driver_pkg: lux.software.driver_pkg, driver_ver: lux.software.driver_version, runtime_ver: input.spec.runtime, brain_id: "C-001", status: "passed" });
  const result = solve(input);
  if (result.status !== "solved" || !result.plans[0]) throw new Error("Synthetic solver fixture failed");
  const plan = result.plans[0];
  const parts = input.parts.filter(part => plan.part_versions.some(pin => pin.id === part.id && pin.version === part.version));
  const sensor = parts.find(part => part.id === "V-005")!;
  const metadata = BuildPlanMetadata.parse({ schema_version: 1, runtime: plan.runtime, profile: plan.profile, total_cost_usd: plan.total_cost_usd,
    input_digest: "a".repeat(64), evidence: { parts, connectors: input.connectors, profile: input.profiles.find(profile => profile.id === plan.profile.id)!, compat: input.compat } });
  const profile = ProvisioningProfile.parse({ id: "synthetic-lux-provisioning", version: "1.0.0", assembly_profile: plan.profile,
    runtime: plan.runtime, part_versions: plan.part_versions, firmware_profile_id: "esp32s3-bh1750-usb-v1",
    health_sources: [{ part: plan.wiring_graph.brain, telemetry_schema: "device_health.v1" }],
    channels: [
      { key: "illuminance", range: { unit: "lux", min: 0, max: 65535 }, part: { id: sensor.id, version: sensor.version }, telemetry_schema: sensor.cloud.telemetry_schema },
    ] });
  const spec = { settled: true, capabilities: ["read.illuminance_lux"], sense: { what: ["illuminance"], interval_s: 60 }, act: { what: [] },
    environment: { location: "indoors", flags: [] }, connect: { transport: "wifi", experience: [] }, power: { source: "usb" },
    experience: { dashboard: true }, assumptions: [], open_questions: [] };
  metadata.input_digest = createHash("sha256").update(serializeBuildPlanInput({ spec, runtime: plan.runtime, evidence: metadata.evidence }), "utf8").digest("hex");
  return { plan, metadata, profile, spec };
}
export async function seedProvisioningFixture(pool: Pool, tenantId: string, userId: string) {
  const model = provisioningFixtureModel(), buildId = randomUUID();
  await pool.query("INSERT INTO builds.builds(id,tenant_id,created_by_user_id,status,ask_text) VALUES($1,$2,$3,'ready','SYNTHETIC self-flash fixture')", [buildId, tenantId, userId]);
  await pool.query("INSERT INTO builds.specs(build_id,version,data,confidence) VALUES($1,1,$2,1)", [buildId, model.spec]);
  await pool.query(`INSERT INTO builds.plans(build_id,version,spec_version,part_versions,wiring_graph,power_budget,bom,solver_log,metadata,accepted_at,accepted_by)
    VALUES($1,1,1,$2,$3,$4,$5,$6,$7,now(),$8)`, [buildId, JSON.stringify(model.plan.part_versions), model.plan.wiring_graph,
    model.plan.power_budget, JSON.stringify(model.plan.bom), JSON.stringify(model.plan.solver_log), model.metadata, userId]);
  const manifest: FirmwarePassedRecord["manifest"] = { v: 1, build_id: buildId, plan_version: 1, code_version: 1,
    profile_id: model.profile.firmware_profile_id, runtime: model.plan.runtime,
    channels: Object.fromEntries(model.profile.channels.map(channel => [channel.key, channel.range])),
    files: ["bootloader.bin", "partition-table.bin", "albusforge.bin"].map(path => ({ path: path as "bootloader.bin", sha256: "b".repeat(64), size: 100 })),
    flash: { chip: "esp32s3", config_offset: 36864, config_size: 24576 } };
  const firmware: FirmwarePassedRecord = { schema_version: 1, candidate_id: manifest.profile_id, manifest,
    manifest_digest: createHash("sha256").update(serializeFirmwareManifest(manifest)).digest("hex"),
    compiler: { image_digest: `espressif/idf@sha256:${"c".repeat(64)}`, idf_version: "5.5.3" }, source_sha256: "d".repeat(64),
    instruction: "Synthetic software fixture", diagnostics: "Synthetic record; not actual compiler/hardware acceptance" };
  await pool.query("INSERT INTO builds.code_bundles(build_id,version,plan_version,status,storage_ref,compile_log) VALUES($1,1,1,'passed','synthetic-not-a-download',$2)", [buildId, firmware]);
  return { ...model, buildId, firmware };
}
export async function provisioningUser(pool: Pool, role = "admin") {
  const tenantId = randomUUID(), userId = randomUUID(), sessionId = randomUUID(), token = randomBytes(32).toString("base64url");
  await pool.query("INSERT INTO users.tenants(id,name) VALUES($1,'Synthetic provisioning workspace')", [tenantId]);
  await pool.query("INSERT INTO users.users(id,email) VALUES($1,$2)", [userId, `${userId}@example.test`]);
  await pool.query("INSERT INTO users.tenant_members(tenant_id,user_id,role) VALUES($1,$2,$3)", [tenantId, userId, role]);
  await pool.query("INSERT INTO users.sessions(id,user_id,active_tenant_id,token_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 day')", [sessionId, userId, tenantId, createHash("sha256").update(token).digest("hex")]);
  return { tenantId, userId, sessionId, cookie: `__Host-albus_session=${token}` };
}
