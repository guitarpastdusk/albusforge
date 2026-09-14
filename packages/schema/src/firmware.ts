import { z } from "zod";
import { TelemetryChannels } from "./telemetry";
import { SemVer } from "./part";

export const FirmwareFile = z.strictObject({
  path: z.enum(["bootloader.bin", "partition-table.bin", "albusforge.bin"]),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().positive().max(3 * 1024 * 1024),
});
/** Canonical JSON digest binds a device configuration to credential-free binaries. */
export const FirmwareManifest = z.strictObject({
  v: z.literal(1),
  build_id: z.uuid(),
  plan_version: z.number().int().positive(),
  code_version: z.number().int().positive(),
  profile_id: z.string().min(1).max(120),
  runtime: SemVer,
  channels: TelemetryChannels,
  files: z.array(FirmwareFile).length(3).refine(files => new Set(files.map(file => file.path)).size === 3),
  flash: z.strictObject({ chip: z.literal("esp32s3"), config_offset: z.literal(36864), config_size: z.literal(24576) }),
});
export type FirmwareManifest = z.infer<typeof FirmwareManifest>;

/** Persisted in code_bundles.compile_log when status=passed. */
export const FirmwarePassedRecord = z.strictObject({
  schema_version: z.literal(1),
  candidate_id: z.string().min(1).max(120),
  manifest: FirmwareManifest,
  manifest_digest: z.string().regex(/^[a-f0-9]{64}$/),
  compiler: z.strictObject({ image_digest: z.string().regex(/^espressif\/idf@sha256:[a-f0-9]{64}$/), idf_version: z.literal("5.5.3") }),
  source_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  instruction: z.string().max(500),
  diagnostics: z.string().max(20000),
});
export type FirmwarePassedRecord = z.infer<typeof FirmwarePassedRecord>;

/** Download these exact UTF-8 bytes; installers hash bytes, not a second language's JSON serialization. */
export function serializeFirmwareManifest(input: FirmwareManifest): string {
  const sort = (value: unknown): unknown => Array.isArray(value) ? value.map(sort)
    : value !== null && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, sort(item)]))
      : value;
  return JSON.stringify(sort(FirmwareManifest.parse(input)));
}
