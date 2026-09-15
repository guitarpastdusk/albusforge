import { createHash } from "node:crypto";
import { FirmwarePassedRecord, serializeFirmwareManifest, DeviceCapabilities, type SensorCapability, type TelemetryChannels } from "@albusforge/schema";

/** Persisted passed compiler output must match the exact immutable provisioning authority. */
export function verifyProvisioningFirmware(value: unknown, identity: {
  buildId: string; planVersion: number; codeVersion: number; runtime: string;
  firmwareProfileId: string; channels: TelemetryChannels; capabilities?: SensorCapability[];
}): FirmwarePassedRecord | null {
  const parsed = FirmwarePassedRecord.safeParse(value);
  if (!parsed.success) return null;
  const record = parsed.data, manifest = record.manifest;
  if (record.candidate_id !== manifest.profile_id || manifest.build_id !== identity.buildId || manifest.plan_version !== identity.planVersion || manifest.code_version !== identity.codeVersion
    || manifest.runtime !== identity.runtime || manifest.profile_id !== identity.firmwareProfileId) return null;
  const keys = Object.keys(identity.channels);
  if (keys.length !== Object.keys(manifest.channels).length || keys.some(key => {
    const actual = manifest.channels[key], expected = identity.channels[key]!;
    return !actual || actual.unit !== expected.unit || actual.min !== expected.min || actual.max !== expected.max;
  })) return null;
  const expectedCapabilities = identity.capabilities ?? [];
  if (JSON.stringify(DeviceCapabilities.optional().parse(manifest.capabilities)) !== JSON.stringify(expectedCapabilities.length ? DeviceCapabilities.parse(expectedCapabilities) : undefined)) return null;
  const digest = createHash("sha256").update(serializeFirmwareManifest(manifest), "utf8").digest("hex");
  return digest === record.manifest_digest ? record : null;
}
