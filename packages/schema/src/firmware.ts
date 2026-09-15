import { z } from "zod";
import { ProvisionedChannels } from "./telemetry";
import { DeviceCapabilities } from "./observations";
import { SemVer } from "./part";

export const FirmwareFile = z.strictObject({
  path: z.enum(["bootloader.bin", "partition-table.bin", "albusforge.bin"]),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size: z
    .number()
    .int()
    .positive()
    .max(3 * 1024 * 1024),
});
/** Canonical JSON digest binds a device configuration to credential-free binaries. */
export const FirmwareManifest = z.strictObject({
  v: z.literal(1),
  build_id: z.uuid(),
  plan_version: z.number().int().positive(),
  code_version: z.number().int().positive(),
  profile_id: z.string().min(1).max(120),
  runtime: SemVer,
  channels: ProvisionedChannels,
  capabilities: DeviceCapabilities.optional(),
  files: z
    .array(FirmwareFile)
    .length(3)
    .refine((files) => new Set(files.map((file) => file.path)).size === 3),
  flash: z.strictObject({
    chip: z.literal("esp32s3"),
    config_offset: z.literal(36864),
    config_size: z.literal(24576),
  }),
}).refine(manifest => Object.keys(manifest.channels).length > 0 || manifest.capabilities?.some(c => c.kind === "image"), "Firmware must declare channels or image capabilities");
export type FirmwareManifest = z.infer<typeof FirmwareManifest>;

export const FirmwareJobRequest = z.strictObject({
  request_id: z.uuid(),
  interval_s: z.number().int().min(10).max(86400),
  instruction: z.string().max(500),
  based_on: z.number().int().positive().nullable(),
  attempts: z.number().int().min(0).max(3),
});
export type FirmwareJobRequest = z.infer<typeof FirmwareJobRequest>;

/** Persisted in code_bundles.compile_log when status=passed. */
export const FirmwarePassedRecord = z.strictObject({
  schema_version: z.literal(1),
  job: FirmwareJobRequest.optional(),
  candidate_id: z.string().min(1).max(120),
  manifest: FirmwareManifest,
  manifest_digest: z.string().regex(/^[a-f0-9]{64}$/),
  compiler: z.strictObject({
    image_digest: z.string().regex(/^espressif\/idf@sha256:[a-f0-9]{64}$/),
    idf_version: z.literal("5.5.3"),
  }),
  bundle_sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  source_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  instruction: z.string().max(500),
  diagnostics: z.string().max(20000),
});
export type FirmwarePassedRecord = z.infer<typeof FirmwarePassedRecord>;

/** Download these exact UTF-8 bytes; installers hash bytes, not a second language's JSON serialization. */
export function serializeFirmwareManifest(input: FirmwareManifest): string {
  const sort = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(sort)
      : value !== null && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, item]) => [key, sort(item)]),
          )
        : value;
  return JSON.stringify(sort(FirmwareManifest.parse(input)));
}

export const FirmwareRequest = z.strictObject({
  tenant_id: z.uuid(),
  plan_version: z.number().int().positive(),
  request_id: z.uuid(),
  instruction: z.string().trim().min(1).max(500).optional(),
  based_on: z.number().int().positive().optional(),
});
export const FirmwareRetryRequest = z.strictObject({ tenant_id: z.uuid() });
export const FirmwareVersion = z.strictObject({
  version: z.number().int().positive(),
  plan_version: z.number().int().positive(),
  status: z.enum(["pending", "running", "passed", "failed"]),
  current: z.boolean(),
  interval_s: z.number().int().min(10).max(86400).nullable(),
  attempts: z.number().int().min(0).max(3),
  source: z.string().max(2000).nullable(),
  previous_source: z.string().max(2000).nullable(),
  error: z.string().max(1000).nullable(),
  diagnostics: z.string().max(20000).nullable(),
  manifest: FirmwareManifest.nullable(),
  created_at: z.iso.datetime({ offset: true }),
});
export const FirmwarePage = z.strictObject({
  build_id: z.uuid(),
  tenant_id: z.uuid(),
  can_edit: z.boolean(),
  compiler_available: z.boolean(),
  accepted_plan_version: z.number().int().positive().nullable(),
  versions: z.array(FirmwareVersion).max(20),
});
export type FirmwarePage = z.infer<typeof FirmwarePage>;
