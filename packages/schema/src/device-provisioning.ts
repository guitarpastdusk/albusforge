import { z } from "zod";
import { TelemetryChannels, ProvisionedChannels } from "./telemetry";
import { DeviceCapabilities } from "./observations";
import { SemVer } from "./part";

const CanonicalToken = z.string().regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/);
const Digest = z.string().regex(/^[a-f0-9]{64}$/);
export const DeviceClaimRequest = z.strictObject({ expected_tenant_id: z.uuid(), build_id: z.uuid(), plan_version: z.number().int().positive(), code_version: z.number().int().positive(), request_id: z.uuid() });
export const DeviceHandoffRequest = z.strictObject({ expected_tenant_id: z.uuid(), expected_version: z.number().int().positive() });
export const DeviceReissueRequest = DeviceHandoffRequest.extend({ request_id: z.uuid() });

/** Secret download only. Never return this from public status/read APIs or persist in artifacts. */
export const DeviceConfigV1 = z.strictObject({
  v: z.literal(1),
  device_id: z.uuid(),
  token: CanonicalToken,
  ingest_url: z.url().regex(/^(https:\/\/[^/?#@\s]+|http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?)\/ingest\/v1$/, "Expected HTTPS ingestion URL or local loopback test URL"),
  seq_start: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  profile_id: z.string().min(1).max(120),
  runtime: SemVer,
  channels: TelemetryChannels,
  build_id: z.uuid(),
  plan_version: z.number().int().positive(),
  code_version: z.number().int().positive(),
  manifest_digest: Digest,
});
export type DeviceConfigV1 = z.infer<typeof DeviceConfigV1>;
export const DeviceConfigV2 = DeviceConfigV1.extend({
  v: z.literal(2),
  channels: ProvisionedChannels,
  capabilities: DeviceCapabilities,
  observation_url: z.url(),
}).superRefine((config, ctx) => {
  if (config.observation_url !== config.ingest_url.replace(/\/ingest\/v1$/, `/ingest/v2/devices/${config.device_id}/observations`)) {
    ctx.addIssue({ code: "custom", path: ["observation_url"], message: "Observation URL must match the device and trusted ingestion origin" });
  }
  const numeric = Object.assign({}, ...config.capabilities.filter(c => c.kind === "measurement").map(c => c.channels));
  const keys = Object.keys(config.channels);
  if (keys.length !== Object.keys(numeric).length || keys.some(key => JSON.stringify(config.channels[key]) !== JSON.stringify(numeric[key]))) {
    ctx.addIssue({ code: "custom", path: ["channels"], message: "Channels must match measurement capabilities" });
  }
});
export type DeviceConfigV2 = z.infer<typeof DeviceConfigV2>;
export const DeviceConfig = z.union([DeviceConfigV1, DeviceConfigV2]);

/** Public state. A handoff is bound to its issuing user/session family, never a bearer URL. */
export const DeviceProvisioning = z.strictObject({
  device_id: z.uuid(), build_id: z.uuid(), plan_version: z.number().int().positive(), code_version: z.number().int().positive(),
  credential_version: z.number().int().positive(),
  state: z.enum(["configuration_ready", "configuration_downloaded", "configuration_expired", "credential_revoked"]),
  handoff_expires_at: z.iso.datetime({ offset: true }),
  handoff_available: z.boolean(),
  created_at: z.iso.datetime({ offset: true }),
});
export type DeviceProvisioning = z.infer<typeof DeviceProvisioning>;
