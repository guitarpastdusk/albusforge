import { z } from "zod";
import { TelemetryChannels, TelemetryEnvelope } from "./telemetry";

const Time = z.iso.datetime({ offset: true });
const Count = z.string().regex(/^\d+$/);
export const TelemetryDeviceParams = z.strictObject({ id: z.uuid() });
export const TelemetryFleetQuery = z.strictObject({
  after: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const TelemetrySeriesQuery = z.strictObject({
  channel: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  from: Time,
  to: Time,
  resolution: z.enum(["raw", "1m", "1h"]).default("raw"),
  limit: z.coerce.number().int().min(1).max(2000).default(1000),
}).superRefine((q, ctx) => {
  const start = Date.parse(q.from), end = Date.parse(q.to);
  const maximum = { raw: 86400, "1m": 7 * 86400, "1h": 366 * 86400 }[q.resolution] * 1000;
  if (end <= start || end - start > maximum) ctx.addIssue({ code: "custom", message: "Invalid or excessive history window" });
  const unit = { raw: 1, "1m": 60000, "1h": 3600000 }[q.resolution];
  if (start % unit || end % unit) ctx.addIssue({ code: "custom", message: "Rollup bounds must align to UTC bucket boundaries" });
});
export type TelemetrySeriesQuery = z.infer<typeof TelemetrySeriesQuery>;

export const TelemetryDeviceState = z.strictObject({
  id: z.uuid(),
  status: z.enum(["online", "offline", "never_seen"]),
  last_seen_at: Time.nullable(),
  next_s: z.number().int().positive(),
  revoked_at: Time.nullable(),
  health: TelemetryEnvelope.shape.st.nullable(),
});
export const TelemetryFleetPage = z.strictObject({
  devices: z.array(TelemetryDeviceState).max(100),
  next_after: z.uuid().nullable(),
});
export const TelemetryDeviceDetail = z.strictObject({
  device: TelemetryDeviceState,
  channels: TelemetryChannels,
});
export const TelemetryLatest = z.strictObject({
  device_id: z.uuid(),
  readings: z.array(z.strictObject({
    channel: z.string(), t: Time, v: z.number().finite(), seq: Count, ordinal: z.number().int().nonnegative(),
  })).max(64),
});
export const TelemetryHistory = z.strictObject({
  device_id: z.uuid(), channel: z.string(), from: Time, to: Time,
  resolution: z.enum(["raw", "1m", "1h"]),
  /** Dirty hours can leave rollups stale or absent until the worker catches up. */
  pending_rollup: z.boolean(),
  points: z.array(z.union([
    z.strictObject({ t: Time, v: z.number().finite(), seq: Count, ordinal: z.number().int().nonnegative() }),
    z.strictObject({ t: Time, v: z.number().finite(), n: Count, sum: z.string(), min: z.number().finite(), max: z.number().finite(), last: z.number().finite(), stddev: z.string() }),
  ])).max(2000),
});
