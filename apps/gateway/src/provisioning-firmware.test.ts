import { createHash, randomUUID } from "node:crypto";
import { serializeFirmwareManifest, type FirmwarePassedRecord } from "@albusforge/schema";
import { expect, it } from "vitest";
import { verifyProvisioningFirmware } from "./provisioning-firmware";
function fixture() {
  const identity = { buildId: randomUUID(), planVersion: 1, codeVersion: 2, runtime: "0.1.0", firmwareProfileId: "test-only", channels: { illuminance: { unit: "lux", min: 0, max: 65535 } } };
  const manifest: FirmwarePassedRecord["manifest"] = { v: 1, build_id: identity.buildId, plan_version: 1, code_version: 2, runtime: identity.runtime, profile_id: identity.firmwareProfileId, channels: identity.channels, files: ["bootloader.bin", "partition-table.bin", "albusforge.bin"].map(path => ({ path: path as "bootloader.bin", sha256: "b".repeat(64), size: 100 })), flash: { chip: "esp32s3", config_offset: 36864, config_size: 24576 } };
  const record: FirmwarePassedRecord = { schema_version: 1, candidate_id: "test-only", manifest, manifest_digest: createHash("sha256").update(serializeFirmwareManifest(manifest)).digest("hex"), compiler: { image_digest: `espressif/idf@sha256:${"c".repeat(64)}`, idf_version: "5.5.3" }, source_sha256: "d".repeat(64), instruction: "test fixture only", diagnostics: "test fixture only; not hardware acceptance" };
  return { identity, record };
}
it("requires exact build, plan, code, runtime, compiler profile and channel authority", () => {
  const { identity, record } = fixture();
  expect(verifyProvisioningFirmware(record, identity)).toEqual(record);
  for (const change of [{ buildId: randomUUID() }, { planVersion: 3 }, { codeVersion: 3 }, { runtime: "0.2.0" }, { firmwareProfileId: "other" }, { channels: { illuminance: { unit: "lux", min: 0, max: 10 } } }, { channels: { invented: { unit: "C", min: 0, max: 65535 } } }]) expect(verifyProvisioningFirmware(record, { ...identity, ...change })).toBeNull();
});
it("rejects modified manifest bytes, missing evidence and unexpected persisted fields", () => {
  const { identity, record } = fixture();
  expect(verifyProvisioningFirmware({ ...record, manifest_digest: "0".repeat(64) }, identity)).toBeNull();
  expect(verifyProvisioningFirmware({ ...record, compiler: undefined }, identity)).toBeNull();
  expect(verifyProvisioningFirmware({ ...record, token: "must never be in compiler output" }, identity)).toBeNull();
  expect(verifyProvisioningFirmware({ ...record, manifest: { ...record.manifest, files: record.manifest.files.map(file => ({ ...file, size: file.size + 1 })) } }, identity)).toBeNull();
});
