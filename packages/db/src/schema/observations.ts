import { sql } from "drizzle-orm";
import { bigint, boolean, check, foreignKey, index, integer, jsonb, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { telemetryDevices, telemetrySchema } from "./telemetry.js";

export const deviceCapabilities = telemetrySchema.table("device_capabilities", {
  deviceId: uuid("device_id").notNull().references(() => telemetryDevices.id, { onDelete: "cascade" }),
  capabilityId: text("capability_id").notNull(),
  kind: text("kind").notNull(),
  payloadSchema: text("payload_schema").notNull(),
  profileId: text("profile_id").notNull(),
  profileVersion: integer("profile_version").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  required: boolean("required").notNull().default(true),
  intervalS: integer("interval_s").notNull(),
  maxBytes: integer("max_bytes"),
  maxWidth: integer("max_width"),
  maxHeight: integer("max_height"),
  channels: jsonb("channels"),
}, t => [
  primaryKey({ columns: [t.deviceId, t.capabilityId] }),
  check("device_capabilities_identity_check", sql`${t.capabilityId} ~ '^[a-z][a-z0-9_.-]{0,63}$' AND length(${t.profileId}) BETWEEN 1 AND 128 AND ${t.profileVersion}>0`),
  check("device_capabilities_interval_check", sql`${t.intervalS} BETWEEN 1 AND 86400`),
  check("device_capabilities_kind_check", sql`(${t.kind}='image' AND ${t.payloadSchema}='jpeg.v1' AND ${t.maxBytes} IS NOT NULL AND ${t.maxBytes} BETWEEN 1 AND 1048576 AND ${t.maxWidth} IS NOT NULL AND ${t.maxWidth} BETWEEN 1 AND 4096 AND ${t.maxHeight} IS NOT NULL AND ${t.maxHeight} BETWEEN 1 AND 4096 AND ${t.channels} IS NULL) OR (${t.kind}='measurement' AND ${t.payloadSchema}='readings.v1' AND ${t.channels} IS NOT NULL AND jsonb_typeof(${t.channels})='object' AND ${t.channels}<>'{}'::jsonb AND ${t.maxBytes} IS NULL AND ${t.maxWidth} IS NULL AND ${t.maxHeight} IS NULL)`),
]);

/** Compact receipts outlive media retention so historical retries cannot recreate it. */
export const observationReceipts = telemetrySchema.table("observation_receipts", {
  deviceId: uuid("device_id").notNull().references(() => telemetryDevices.id, { onDelete: "cascade" }),
  observationId: uuid("observation_id").notNull(),
  capabilityId: text("capability_id").notNull(),
  kind: text("kind").notNull().default("image"),
  payloadSchema: text("payload_schema").notNull().default("jpeg.v1"),
  fingerprint: text("fingerprint").notNull(),
  sha256: text("sha256").notNull(),
  bytes: integer("bytes").notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  state: text("state").notNull(),
  leaseId: uuid("lease_id"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  reservedDay: text("reserved_day").notNull(),
}, t => [
  primaryKey({ columns: [t.deviceId, t.observationId] }),
  index("observation_receipts_history_idx").on(t.deviceId, t.capabilityId, t.capturedAt, t.observationId),
  index("observation_receipts_expiry_idx").on(t.state, t.expiresAt),
  index("observation_receipts_lease_idx").on(t.state, t.leaseUntil),
  index("observation_receipts_reservations_idx").on(t.deviceId, t.reservedDay, t.state),
  check("observation_receipts_digest_check", sql`${t.fingerprint} ~ '^[a-f0-9]{64}$' AND ${t.sha256} ~ '^[a-f0-9]{64}$'`),
  check("observation_receipts_bytes_check", sql`${t.bytes} BETWEEN 1 AND 1048576`),
  check("observation_receipts_kind_check", sql`${t.kind}='image' AND ${t.payloadSchema}='jpeg.v1'`),
  check("observation_receipts_state_check", sql`(${t.state}='reserved' AND ${t.receivedAt} IS NULL AND ${t.leaseId} IS NOT NULL AND ${t.leaseUntil} IS NOT NULL) OR (${t.state}='stored' AND ${t.receivedAt} IS NOT NULL AND ${t.leaseId} IS NULL AND ${t.leaseUntil} IS NULL) OR (${t.state}='expired' AND ${t.leaseId} IS NULL AND ${t.leaseUntil} IS NULL)`),
  check("observation_receipts_lease_check", sql`(${t.leaseId} IS NULL) = (${t.leaseUntil} IS NULL)`),
  check("observation_receipts_day_check", sql`${t.reservedDay} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`),
]);
export const observationImages = telemetrySchema.table("observation_images", {
  deviceId: uuid("device_id").notNull(),
  observationId: uuid("observation_id").notNull(),
  objectKey: text("object_key").notNull().unique(),
  generation: text("generation"),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
}, t => [
  primaryKey({ columns: [t.deviceId, t.observationId] }),
  foreignKey({ columns: [t.deviceId, t.observationId], foreignColumns: [observationReceipts.deviceId, observationReceipts.observationId] }).onDelete("cascade"),
  check("observation_images_generation_check", sql`${t.generation} IS NULL OR ${t.generation} ~ '^[1-9][0-9]*$'`),
  check("observation_images_dimensions_check", sql`${t.width} BETWEEN 1 AND 4096 AND ${t.height} BETWEEN 1 AND 4096`),
]);
export const observationUsage = telemetrySchema.table("observation_usage", {
  deviceId: uuid("device_id").notNull().references(() => telemetryDevices.id, { onDelete: "cascade" }),
  day: text("day").notNull(),
  acceptedCount: bigint("accepted_count", { mode: "number" }).notNull().default(0),
  acceptedBytes: bigint("accepted_bytes", { mode: "number" }).notNull().default(0),
}, t => [primaryKey({ columns: [t.deviceId, t.day] }), check("observation_usage_nonnegative_check", sql`${t.acceptedCount}>=0 AND ${t.acceptedBytes}>=0`)]);
export const capabilityPresence = telemetrySchema.table("capability_presence", {
  deviceId: uuid("device_id").notNull(),
  capabilityId: text("capability_id").notNull(),
  lastCaptureAt: timestamp("last_capture_at", { withTimezone: true }).notNull(),
  lastReceivedAt: timestamp("last_received_at", { withTimezone: true }).notNull(),
}, t => [
  primaryKey({ columns: [t.deviceId, t.capabilityId] }),
  foreignKey({ columns: [t.deviceId, t.capabilityId], foreignColumns: [deviceCapabilities.deviceId, deviceCapabilities.capabilityId] }).onDelete("cascade"),
]);
/** No device FK: object cleanup must survive deletion of its tenant/device. */
export const observationDeletionIntents = telemetrySchema.table("observation_deletion_intents", {
  objectKey: text("object_key").primaryKey(),
  generation: text("generation"),
  queuedAt: timestamp("queued_at", { withTimezone: true }).notNull().defaultNow(),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  attempts: integer("attempts").notNull().default(0),
}, t => [check("observation_deletion_intents_generation_check", sql`${t.generation} IS NULL OR ${t.generation} ~ '^[1-9][0-9]*$'`), index("observation_deletion_intents_queue_idx").on(t.queuedAt), check("observation_deletion_intents_attempts_check", sql`${t.attempts}>=0`)]);

export const observationAttempts = telemetrySchema.table("observation_attempts", {
  deviceId: uuid("device_id").primaryKey().references(() => telemetryDevices.id, { onDelete: "cascade" }),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  attempts: integer("attempts").notNull(),
}, t => [check("observation_attempts_nonnegative_check", sql`${t.attempts}>=0`)]);
