import { createHash } from "node:crypto";
import { BuildPlanMetadata, BuildPlanV1, FirmwarePassedRecord, Spec, serializeBuildPlanInput } from "@albusforge/schema";
import type { PoolClient } from "pg";
import { HttpError } from "./http";
import { resolveProvisioningProfile, type ProvisioningProfile } from "./provisioning-profile";
import { verifyProvisioningFirmware } from "./provisioning-firmware";

/** Server-owned accepted-plan/compile adapter. Call before taking a device lock. */
export async function loadProvisioningAuthority(client: PoolClient, tenantId: string, buildId: string, planVersion: number,
  codeVersion: number, profiles: readonly ProvisioningProfile[], requireCurrent = true) {
  const build = (await client.query("SELECT id FROM builds.builds WHERE id=$1 AND tenant_id=$2 FOR UPDATE", [buildId, tenantId])).rows[0];
  if (!build) throw new HttpError(404, "NOT_FOUND", "Build not found");
  const row = (await client.query<{
    spec_version: number; accepted_at: Date | null; part_versions: unknown; wiring_graph: unknown;
    power_budget: unknown; bom: unknown; solver_log: unknown; metadata: unknown;
  }>("SELECT spec_version,accepted_at,part_versions,wiring_graph,power_budget,bom,solver_log,metadata FROM builds.plans WHERE build_id=$1 AND version=$2 FOR SHARE", [buildId, planVersion])).rows[0];
  if (!row?.accepted_at) throw new HttpError(409, "PLAN_NOT_ACCEPTED", "Accept this build plan before provisioning a device");
  if (requireCurrent) {
    const latest = (await client.query<{ version: number | null }>("SELECT max(version) AS version FROM builds.specs WHERE build_id=$1", [buildId])).rows[0]?.version;
    if (latest !== row.spec_version) throw new HttpError(409, "PLAN_STALE", "The build specification changed; accept a current plan before provisioning");
  }
  const storedSpec = (await client.query("SELECT data FROM builds.specs WHERE build_id=$1 AND version=$2", [buildId, row.spec_version])).rows[0]?.data;
  const spec = Spec.safeParse(storedSpec);
  const interval = spec.success ? spec.data.sense.interval_s : undefined;
  if (interval === undefined || !Number.isInteger(interval) || interval < 1 || interval > 86400) throw new HttpError(409, "PROVISIONING_UNAVAILABLE", "This plan has no supported upload interval");
  const metadata = BuildPlanMetadata.safeParse(row.metadata);
  if (!metadata.success) throw new HttpError(409, "PROVISIONING_UNAVAILABLE", "This plan has no supported provisioning evidence");
  const evidence = metadata.data.evidence;
  const expectedDigest = createHash("sha256").update(serializeBuildPlanInput({ spec: storedSpec, runtime: metadata.data.runtime, evidence }), "utf8").digest("hex");
  if (metadata.data.input_digest !== expectedDigest) throw new HttpError(409, "PROVISIONING_UNAVAILABLE", "This plan has inconsistent provisioning evidence");
  const parsedPlan = BuildPlanV1.safeParse({ part_versions: row.part_versions, wiring_graph: row.wiring_graph,
    power_budget: row.power_budget, bom: row.bom, solver_log: row.solver_log, runtime: metadata.data.runtime,
    profile: metadata.data.profile, total_cost_usd: metadata.data.total_cost_usd });
  if (!parsedPlan.success) throw new HttpError(409, "PROVISIONING_UNAVAILABLE", "This plan has no supported provisioning evidence");
  const plan = parsedPlan.data;
  if (evidence.profile.id !== plan.profile.id || evidence.profile.version !== plan.profile.version
    || evidence.profile.brain.id !== plan.wiring_graph.brain.id || evidence.profile.brain.version !== plan.wiring_graph.brain.version
    || evidence.profile.source.id !== plan.wiring_graph.source.id || evidence.profile.source.version !== plan.wiring_graph.source.version
    || evidence.parts.some(part => part.software.driver_pkg !== null && !evidence.compat.some(compat => compat.status === "passed"
      && compat.driver_pkg === part.software.driver_pkg && compat.driver_ver === part.software.driver_version
      && compat.brain_id === plan.wiring_graph.brain.id && compat.runtime_ver === plan.runtime))) {
    throw new HttpError(409, "PROVISIONING_UNAVAILABLE", "This plan has no supported provisioning evidence");
  }
  const bundle = (await client.query<{ status: string; storage_ref: string | null; compile_log: unknown }>(
    "SELECT status,storage_ref,compile_log FROM builds.code_bundles WHERE build_id=$1 AND plan_version=$2 AND version=$3 FOR SHARE", [buildId, planVersion, codeVersion])).rows[0];
  const preliminary = FirmwarePassedRecord.safeParse(bundle?.compile_log);
  if (!bundle || bundle.status !== "passed" || !bundle.storage_ref || !preliminary.success) throw new HttpError(409, "FIRMWARE_NOT_READY", "Compile supported firmware for this exact plan before provisioning");
  const provisioned = resolveProvisioningProfile(profiles, plan, evidence.parts, preliminary.data.manifest.profile_id);
  if (!provisioned) throw new HttpError(409, "PROVISIONING_UNAVAILABLE", "This plan has no approved channel and firmware provisioning profile");
  if (provisioned.capabilities.some(cap => cap.enabled && cap.interval_s < interval)) throw new HttpError(409, "PROVISIONING_UNAVAILABLE", "A capability samples faster than the accepted power budget");
  const firmware = verifyProvisioningFirmware(bundle.compile_log, { buildId, planVersion, codeVersion, runtime: plan.runtime,
    firmwareProfileId: provisioned.profile.firmware_profile_id, channels: provisioned.channels, capabilities: provisioned.capabilities });
  // Longer compiled intervals preserve the accepted power budget; shorter ones do not.
  const compiledInterval = firmware?.job?.interval_s ?? interval;
  if (!firmware || compiledInterval < interval) throw new HttpError(409, "FIRMWARE_NOT_READY", "Firmware evidence does not match this exact plan and channel profile");
  return { channels: provisioned.channels, capabilities: provisioned.capabilities, nextS: compiledInterval, firmware, source: {
    kind: "self_flash", schema_version: 1, build_id: buildId, plan_version: planVersion, code_version: codeVersion,
    input_digest: metadata.data.input_digest, part_versions: plan.part_versions, assembly_profile: plan.profile,
    channel_profile: provisioned.profile, manifest_digest: firmware.manifest_digest,
  } };
}
