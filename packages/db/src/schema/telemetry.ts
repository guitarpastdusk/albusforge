import { bigint, doublePrecision, index, integer, jsonb, numeric, pgSchema, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./users.js";
import { createdAt } from "./columns.js";

export const telemetrySchema = pgSchema("telemetry");
export const telemetryDevices = telemetrySchema.table("devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  channels: jsonb("channels").notNull(),
  // Immutable provisioning snapshot; production provisioning must derive this from BuildPlan.
  source: jsonb("source").notNull(),
  nextS: integer("next_s").notNull().default(300),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  lastSeq: bigint("last_seq", { mode: "number" }),
  status: jsonb("status"),
  createdAt: createdAt(),
}, (t) => [index("devices_tenant_idx").on(t.tenantId)]);
export const telemetryPackets = telemetrySchema.table("packets", {
  deviceId: uuid("device_id").notNull().references(() => telemetryDevices.id, { onDelete: "cascade" }),
  seq: bigint("seq", { mode: "number" }).notNull(),
  fingerprint: text("fingerprint").notNull(),
  response: jsonb("response").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.deviceId, t.seq] })]);
export const telemetryReadings = telemetrySchema.table("readings", {
  deviceId: uuid("device_id").notNull().references(() => telemetryDevices.id, { onDelete: "cascade" }),
  seq: bigint("seq", { mode: "number" }).notNull(),
  ordinal: integer("ordinal").notNull(),
  channel: text("channel").notNull(),
  ts: timestamp("ts", { withTimezone: true }).notNull(),
  value: doublePrecision("value").notNull(),
}, (t) => [primaryKey({ columns: [t.deviceId, t.seq, t.ordinal, t.ts] }), index("readings_series_idx").on(t.deviceId, t.channel, t.ts)]);
export const telemetryLatest = telemetrySchema.table("latest", {
  deviceId: uuid("device_id").notNull().references(() => telemetryDevices.id, { onDelete: "cascade" }),
  channel: text("channel").notNull(),
  ts: timestamp("ts", { withTimezone: true }).notNull(),
  seq: bigint("seq", { mode: "number" }).notNull(),
  ordinal: integer("ordinal").notNull(),
  value: doublePrecision("value").notNull(),
}, (t) => [primaryKey({ columns: [t.deviceId, t.channel] })]);
export const telemetryUsage = telemetrySchema.table("usage", {
  deviceId: uuid("device_id").notNull().references(() => telemetryDevices.id, { onDelete: "cascade" }),
  period: text("period").notNull(),
  readingsIn: bigint("readings_in", { mode: "number" }).notNull(),
  payloadBytes: bigint("payload_bytes", { mode: "number" }).notNull(),
}, (t) => [primaryKey({ columns: [t.deviceId, t.period] })]);

/** Hour buckets requiring recomputation; populated transactionally by the insert trigger. */
export const telemetryDirtyHours = telemetrySchema.table("dirty_hours", {
  deviceId: uuid("device_id").notNull().references(() => telemetryDevices.id, { onDelete: "cascade" }),
  channel: text("channel").notNull(),
  bucket: timestamp("bucket", { withTimezone: true }).notNull(),
  queuedAt: createdAt(),
  touchedAt: timestamp("touched_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.deviceId, t.channel, t.bucket] }), index("dirty_hours_bucket_idx").on(t.bucket)]);
export const telemetryRollups = telemetrySchema.table("rollups", {
  deviceId: uuid("device_id").notNull().references(() => telemetryDevices.id, { onDelete: "cascade" }),
  channel: text("channel").notNull(),
  resolution: text("resolution").notNull(),
  bucket: timestamp("bucket", { withTimezone: true }).notNull(),
  n: bigint("n", { mode: "number" }).notNull(),
  sum: numeric("sum").notNull(),
  min: doublePrecision("min").notNull(),
  max: doublePrecision("max").notNull(),
  last: doublePrecision("last").notNull(),
  stddev: numeric("stddev").notNull(),
}, (t) => [primaryKey({ columns: [t.deviceId, t.channel, t.resolution, t.bucket] }), index("rollups_retention_idx").on(t.resolution, t.bucket)]);

export const telemetryRetentionState = telemetrySchema.table("retention_state", {
  id: integer("id").primaryKey(),
  rawBefore: timestamp("raw_before", { withTimezone: true }).notNull(),
});
