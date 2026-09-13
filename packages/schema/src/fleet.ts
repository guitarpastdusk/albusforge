import { z } from "zod";
import { Accent, Id, Timestamp } from "./common";

/**
 * `device_state.status` (CLOUD-PLATFORM.md §5.2). `never_seen` is a device
 * that is provisioned — its dashboard already exists (§6.1) — but has not
 * sent a first reading.
 */
export const DeviceStatus = z.enum(["online", "offline", "never_seen"]);
export type DeviceStatus = z.infer<typeof DeviceStatus>;

/** From part.cloud.telemetry_schema (CLOUD-PLATFORM.md §6.1). */
export const Channel = z.object({
  key: z.string(),
  label: z.string(),
  unit: z.string(),
  kind: z.enum(["number", "duration", "status"]),
  precision: z.number().int().nonnegative(),
  valid_range: z.tuple([z.number(), z.number()]).nullable(),
});
export type Channel = z.infer<typeof Channel>;

export const DeviceTile = z.object({
  id: Id,
  name: z.string(),
  accent: Accent,
  status: DeviceStatus,
  /** Presence observation time, for ordering reconnect snapshots and status events. */
  status_at: Timestamp.optional(),
  /**
   * Formatted with the channel's display precision (CLOUD-PLATFORM.md §6.1).
   * Null until the device's first reading.
   */
  value: z.string().nullable(),
  /** Null when there is no value to label, or the channel has no unit. */
  unit: z.string().nullable(),
  metric: z.string(),
  /** Null for a `never_seen` device. */
  last_reading_at: Timestamp.nullable(),
  /**
   * The channel `value` shows, so a live reading on the stream can be
   * formatted the same way. Optional: a tile without it still updates its
   * age and status live, just not its value.
   */
  channel: Channel.optional(),
  /** Timestamp of the displayed channel, distinct from the latest reading on any channel. */
  value_at: Timestamp.nullable().optional(),
});
export type DeviceTile = z.infer<typeof DeviceTile>;

/** One build's devices, grouped — a "system" on the Live systems screen. */
export const System = z.object({
  build_id: Id,
  name: z.string(),
  location: z.string(),
  devices: z.array(DeviceTile),
});
export type System = z.infer<typeof System>;

export const Fleet = z.object({
  stats: z.object({
    device_count: z.number().int().nonnegative(),
    readings_per_day: z.number().int().nonnegative(),
    online_ratio: z.number().min(0).max(1),
  }),
  systems: z.array(System),
});
export type Fleet = z.infer<typeof Fleet>;
