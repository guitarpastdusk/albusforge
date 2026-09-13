import { z } from "zod";
import { Accent, Id, Timestamp } from "./common";

export const DeviceTile = z.object({
  id: Id,
  name: z.string(),
  accent: Accent,
  online: z.boolean(),
  /**
   * Formatted with the channel's display precision (CLOUD-PLATFORM.md §6.1).
   * Null until the device's first reading.
   */
  value: z.string().nullable(),
  unit: z.string(),
  metric: z.string(),
  /**
   * Null for a device that is provisioned but has never reported — the
   * dashboard exists before the device is powered on (CLOUD-PLATFORM.md §6.1).
   */
  last_reading_at: Timestamp.nullable(),
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
