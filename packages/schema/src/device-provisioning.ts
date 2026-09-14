import { z } from "zod";
import { TelemetryChannels } from "./telemetry";
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
