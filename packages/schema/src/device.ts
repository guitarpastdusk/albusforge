import { z } from "zod";
import { Accent, Id, Timestamp } from "./common";
import { ChatMessage } from "./builds";
import { Channel, DeviceStatus } from "./fleet";


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
 * Where a change to a rule stands on the device. Changes ride back on the
 * device's next check-in (CLOUD-PLATFORM.md §3.4), so a rule the portal just
 * enabled is `pending` until the device acknowledges it. Absent means synced,
 * so older responses still parse.
 */
export const ActionSync = z.enum(["synced", "pending"]);
export type ActionSync = z.infer<typeof ActionSync>;

/**
 * One closed-loop rule: a condition on the device's readings and what it does
 * — drive an actuator (SERVO), call an integration (API), or hand over to a
 * human (ALERT). Created by confirming an ActionProposal, never written
 * directly (PORTAL.md §3, ADR 0010).
 */
export const DeviceAction = z.object({
  id: Id,
  kind: DeviceActionKind,
  rule: z.string(),
  via: z.string(),
  enabled: z.boolean(),
  sync: ActionSync.optional(),
  /** Increments on every write; the device acks a version, so a late ack can't regress a newer change (ADR 0010). */
  version: z.number().int().nonnegative().optional(),
});
export type DeviceAction = z.infer<typeof DeviceAction>;

/** PATCH /v1/devices/:id/actions/:actionId → DeviceAction, `sync: "pending"`. */
export const SetActionEnabledRequest = z.object({
  enabled: z.boolean(),
});
export type SetActionEnabledRequest = z.infer<typeof SetActionEnabledRequest>;

/** POST /v1/devices/:id/actions/proposals — a rule in plain words. */
export const ProposeActionRequest = z.object({
  text: z.string().trim().min(1).max(400),
});
export type ProposeActionRequest = z.infer<typeof ProposeActionRequest>;

/**
 * How the service read a plain-words rule. The person confirms this reading,
 * not their words, so the card shows the normalized rule and any `issues`
 * (a channel the device doesn't have, a missing threshold). A proposal with
 * issues can't be confirmed; `expires_at` bounds how long it can be.
 */
export const ActionProposal = z.object({
  id: Id,
  kind: DeviceActionKind,
  rule: z.string(),
  via: z.string(),
  summary: z.string(),
  issues: z.array(z.string()),
  expires_at: Timestamp,
});
export type ActionProposal = z.infer<typeof ActionProposal>;

/** POST /v1/devices/:id/actions → 201 DeviceAction, `sync: "pending"`. */
export const ConfirmActionRequest = z.object({
  proposal_id: Id,
});
export type ConfirmActionRequest = z.infer<typeof ConfirmActionRequest>;

/** What the session may do with this device's rules; absent means read-only (a viewer, or an older response). */
export const DashboardPermissions = z.object({
  edit_actions: z.boolean(),
});
export type DashboardPermissions = z.infer<typeof DashboardPermissions>;

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
  /** Resolved by gateway from the session's role on the device's tenant (ADR 0009). */
  permissions: DashboardPermissions.optional(),
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

// --- live stream --------------------------------------------------------------

/**
 * SSE events on GET /v1/tenants/:id/stream (CLOUD-PLATFORM.md §6.2). One
 * connection per tab, scoped to the devices the session may see; gateway
 * replays current state on connect. Payloads are JSON; unknown event names
 * are ignored by the portal.
 */
export const STREAM_EVENTS = { reading: "reading", status: "status" } as const;

/** `reading`: one accepted reading. Implies the device is online as of `t`. */
export const ReadingEvent = z.object({
  device_id: Id,
  channel: z.string(),
  v: z.union([z.number(), z.string()]),
  t: Timestamp,
});
export type ReadingEvent = z.infer<typeof ReadingEvent>;

/** `status`: the device's presence changed (offline detection, first sighting). */
export const DeviceStatusEvent = z.object({
  device_id: Id,
  status: DeviceStatus,
  last_reading_at: Timestamp.nullable(),
});
export type DeviceStatusEvent = z.infer<typeof DeviceStatusEvent>;
