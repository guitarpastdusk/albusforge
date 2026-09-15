import { z } from "zod";
import { TelemetryChannels, TelemetryEnvelope } from "./telemetry";

/** Capability identity names a trusted source within a device, not a driver path. */
export const SensorCapabilityId = z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/);
export const ObservationId = z.uuidv4();
export const ObservationDigest = z.string().regex(/^[a-f0-9]{64}$/);
export const ObservationCapturedAt = z.number().int().positive().max(253402300799);
const capabilityBase = {
  id: SensorCapabilityId,
  profile_id: z.string().min(1).max(128),
  profile_version: z.number().int().positive(),
  enabled: z.boolean(),
  required: z.boolean(),
  interval_s: z.number().int().min(1).max(86400),
};
export const ImageCapability = z.strictObject({
  ...capabilityBase,
  kind: z.literal("image"),
  schema: z.literal("jpeg.v1"),
  max_bytes: z.number().int().positive().max(1_048_576),
  max_width: z.number().int().positive().max(4096),
  max_height: z.number().int().positive().max(4096),
});
export const MeasurementCapability = z.strictObject({
  ...capabilityBase,
  kind: z.literal("measurement"),
  schema: z.literal("readings.v1"),
  channels: TelemetryChannels,
});
export const SensorCapability = z.discriminatedUnion("kind", [ImageCapability, MeasurementCapability]);
export type SensorCapability = z.infer<typeof SensorCapability>;
export const DeviceCapabilities = z.array(SensorCapability).min(1).max(64).superRefine((caps, ctx) => {
  const ids = new Set<string>();
  const channels = new Set<string>();
  for (const cap of caps) {
    if (ids.has(cap.id)) ctx.addIssue({ code: "custom", message: "Duplicate capability ID" });
    ids.add(cap.id);
    if (cap.kind === "measurement") {
      for (const channel of Object.keys(cap.channels)) {
        if (channels.has(channel)) ctx.addIssue({ code: "custom", message: "Duplicate device channel ID" });
        channels.add(channel);
      }
    }
  }
});

/** Header parsing is explicit: no coercion of empty strings, fractions or alternate bases. */
export const ObservationMetadata = z.strictObject({
  observation_id: ObservationId,
  capability_id: SensorCapabilityId,
  payload_schema: z.literal("jpeg.v1"),
  captured_at: ObservationCapturedAt,
  sha256: ObservationDigest,
});
export type ObservationMetadata = z.infer<typeof ObservationMetadata>;
export const ObservationHeaders = z.strictObject({
  "x-observation-id": ObservationId,
  "x-capability-id": SensorCapabilityId,
  "x-payload-schema": z.literal("jpeg.v1"),
  "x-captured-at": z.string().regex(/^[1-9][0-9]{0,11}$/).transform(Number).pipe(ObservationCapturedAt),
  "x-content-sha256": ObservationDigest,
});
export const ObservationAck = z.strictObject({
  observation_id: ObservationId,
  state: z.literal("stored"),
  sha256: ObservationDigest,
  bytes: z.number().int().positive().max(1_048_576),
  received_at: z.iso.datetime(),
});
export type ObservationAck = z.infer<typeof ObservationAck>;
export const ObservationError = z.strictObject({
  error: z.strictObject({
    code: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    message: z.string().min(1).max(256),
  }),
});
export const ImageObservationMetadata = z.strictObject({
  device_id: z.uuid(),
  capability_id: SensorCapabilityId,
  observation_id: ObservationId,
  kind: z.literal("image"),
  schema: z.literal("jpeg.v1"),
  sha256: ObservationDigest,
  bytes: z.number().int().positive().max(1_048_576),
  width: z.number().int().positive().max(4096),
  height: z.number().int().positive().max(4096),
  captured_at: z.iso.datetime(),
  received_at: z.iso.datetime(),
  expires_at: z.iso.datetime(),
});
export const ImageObservationPage = z.strictObject({
  images: z.array(ImageObservationMetadata).max(100),
  next_cursor: z.string().max(2048).nullable(),
});
/** Existing numeric codec stays authoritative; this does not introduce a v2 sequence namespace. */
export const MeasurementPayloadV1 = TelemetryEnvelope;
export type ImageObservationMetadata = z.infer<typeof ImageObservationMetadata>;

export const CapabilityStatus = z.strictObject({
  id: SensorCapabilityId, kind: z.enum(["image", "measurement"]), schema: z.string().min(1).max(100),
  enabled: z.boolean(), required: z.boolean(), interval_s: z.number().int().positive(),
  last_capture_at: z.iso.datetime().nullable(), last_received_at: z.iso.datetime().nullable(),
  status: z.enum(["disabled", "waiting", "healthy", "stale", "credential_revoked"]),
});
export const DeviceCapabilityStatus = z.strictObject({ device_id: z.uuid(), capabilities: z.array(CapabilityStatus).max(64) });
export const LatestImageObservation = z.strictObject({ image: ImageObservationMetadata.nullable() });
