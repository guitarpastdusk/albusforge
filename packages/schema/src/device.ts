import { z } from "zod";
import { Accent, Id, Timestamp } from "./common";
import { ChatMessage } from "./builds";
import { DeviceStatus } from "./fleet";

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

const WidgetBase = z.object({
  id: Id,
  channel: z.string(),
});

export const LineChartWidget = WidgetBase.extend({
  type: z.literal("line_chart"),
  window: z.enum(["1h", "24h", "7d", "30d"]),
  threshold: z.object({ value: z.number(), label: z.string() }).nullable(),
});

/** Emphasis for a stat tile's value or caption; `success` is the design's green. */
export const StatTone = z.enum(["default", "success"]);
export type StatTone = z.infer<typeof StatTone>;

export const StatWidget = WidgetBase.extend({
  type: z.literal("stat"),
  caption: z.string().nullable(),
  value_tone: StatTone.optional(),
  caption_tone: StatTone.optional(),
});

/**
 * The dashboard is derived from part.cloud.default_widgets, not configured.
 * The portal renders by `type` and never assumes which widgets a device has.
 */
export const Widget = z.discriminatedUnion("type", [LineChartWidget, StatWidget]);
export type Widget = z.infer<typeof Widget>;

export const Point = z.object({
  t: Timestamp,
  v: z.number(),
});

export const Series = z.object({
  channel: z.string(),
  bucket: z.enum(["raw", "1m", "1h"]),
  points: z.array(Point),
});
export type Series = z.infer<typeof Series>;

export const LatestReading = z.object({
  v: z.union([z.number(), z.string()]),
  t: Timestamp,
});

export const DeviceActionKind = z.enum(["SERVO", "API", "ALERT"]);
export type DeviceActionKind = z.infer<typeof DeviceActionKind>;

/**
 * One closed-loop rule: a condition on the device's readings and what it does
 * — drive an actuator (SERVO), call an integration (API), or hand over to a
 * human (ALERT).
 *
 * TODO(api): read-only today. There is no route to create, enable or disable
 * an action; PORTAL.md §3 needs one (e.g. PATCH /v1/devices/:id/actions/:actionId).
 */
export const DeviceAction = z.object({
  id: Id,
  kind: DeviceActionKind,
  rule: z.string(),
  via: z.string(),
  enabled: z.boolean(),
});
export type DeviceAction = z.infer<typeof DeviceAction>;

export const DeviceDashboard = z.object({
  device: z.object({
    id: Id,
    build_id: Id,
    name: z.string(),
    status: DeviceStatus,
    /**
     * Null until the first reading: the dashboard is derived and provisioned
     * before the device is powered on (CLOUD-PLATFORM.md §6.1).
     */
    last_reading_at: Timestamp.nullable(),
    chips: z.array(z.object({ label: z.string(), accent: Accent })),
  }),
  channels: z.array(Channel),
  widgets: z.array(Widget),
  /** Per channel key. A channel with no reading yet has no key; a never-seen device has `{}`. */
  latest: z.record(z.string(), LatestReading),
  /** Empty for a never-seen device; a series with no points hasn't reported in the window. */
  series: z.array(Series),
  /** Opening line of the device chat, written by the Ask service. The portal falls back to a generic line. */
  greeting: z.string().nullable().optional(),
  /** Closed-loop rules for this device. Absent when the device has none. */
  actions: z.array(DeviceAction).optional(),
  /** The most recent action a rule fired. */
  last_action: z.object({ summary: z.string(), at: Timestamp }).nullable().optional(),
});
export type DeviceDashboard = z.infer<typeof DeviceDashboard>;

export const AskRequest = z.object({
  text: z.string().trim().min(1).max(4000),
});
export type AskRequest = z.infer<typeof AskRequest>;

/** One deterministic, tenant-scoped tool call the answer ran (CLOUD-PLATFORM.md §7.4). */
export const ExecutedQuery = z.object({
  tool: z.string(),
  input: z.record(z.string(), z.unknown()),
});
export type ExecutedQuery = z.infer<typeof ExecutedQuery>;

export const AskResponse = z.object({
  message: ChatMessage,
  /** Every answer ships with the queries it ran, so its numbers can be checked. */
  queries: z.array(ExecutedQuery),
});
export type AskResponse = z.infer<typeof AskResponse>;
