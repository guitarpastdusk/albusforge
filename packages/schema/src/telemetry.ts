import { z } from "zod";

export const TelemetryChannel = z.strictObject({
  unit: z.string().min(1).max(40),
  min: z.number().finite(),
  max: z.number().finite(),
}).refine((c) => c.min <= c.max, "Channel minimum exceeds maximum");
export const TelemetryChannels = z.record(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), TelemetryChannel)
  .refine((c) => Object.keys(c).length > 0 && Object.keys(c).length <= 64, "Expected 1–64 channels");

/** Wire v1. Times are integer epoch seconds; negative reading times offset envelope ts. */
export const TelemetryEnvelope = z.strictObject({
  v: z.literal(1),
  dev: z.uuid(),
  seq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  ts: z.number().int().positive().max(253402300799),
  r: z.array(z.strictObject({
    c: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    t: z.number().int().min(-7_776_000).max(253402300799),
    v: z.number().finite(),
  })).min(1).max(500),
  st: z.strictObject({
    batt_mv: z.number().int().min(0).max(100_000).optional(),
    rssi: z.number().int().min(-150).max(0).optional(),
    up_s: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    health: z.array(z.string().min(1).max(64)).max(16),
  }),
});
export type TelemetryEnvelope = z.infer<typeof TelemetryEnvelope>;
export type TelemetryChannels = z.infer<typeof TelemetryChannels>;

/** Downlink is deliberately empty in the initial ingest slice. */
export const TelemetryAck = z.strictObject({
  ok: z.number().int().min(1).max(500),
  next_s: z.number().int().min(1).max(86400),
  cmd: z.tuple([]),
});
