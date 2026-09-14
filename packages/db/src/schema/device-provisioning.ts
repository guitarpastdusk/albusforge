import { sql } from "drizzle-orm";
import { bigint, check, foreignKey, integer, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { builds, codeBundles, plans } from "./builds.js";
import { createdAt } from "./columns.js";
import { telemetryDevices, telemetrySchema } from "./telemetry.js";
import { sessions, users } from "./users.js";

/** An immutable self-flash identity plus its replaceable, short-lived encrypted handoff. */
export const deviceProvisionings = telemetrySchema.table("device_provisionings", {
  deviceId: uuid("device_id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  buildId: uuid("build_id").notNull(),
  planVersion: integer("plan_version").notNull(),
  codeVersion: integer("code_version").notNull(),
  claimRequestId: uuid("claim_request_id").notNull(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  manifestDigest: text("manifest_digest").notNull(),
  ingestUrl: text("ingest_url").notNull(),
  credentialVersion: integer("credential_version").notNull().default(1),
  seqStart: bigint("seq_start", { mode: "number" }).notNull().default(0),
  handoffUserId: uuid("handoff_user_id").references(() => users.id, { onDelete: "set null" }),
  handoffSessionRoot: uuid("handoff_session_root").references(() => sessions.id, { onDelete: "set null" }),
  handoffExpiresAt: timestamp("handoff_expires_at", { withTimezone: true }).notNull(),
  handoffConsumedAt: timestamp("handoff_consumed_at", { withTimezone: true }),
  handoffKeyId: text("handoff_key_id"),
  handoffNonce: text("handoff_nonce"),
  handoffCiphertext: text("handoff_ciphertext"),
  handoffTag: text("handoff_tag"),
  reissueRequestId: uuid("reissue_request_id"),
  reissueFromVersion: integer("reissue_from_version"),
}, t => [
  foreignKey({ name: "device_provisionings_device_tenant_fk", columns: [t.deviceId, t.tenantId], foreignColumns: [telemetryDevices.id, telemetryDevices.tenantId] }).onDelete("cascade"),
  foreignKey({ name: "device_provisionings_build_tenant_fk", columns: [t.buildId, t.tenantId], foreignColumns: [builds.id, builds.tenantId] }).onDelete("restrict"),
  foreignKey({ name: "device_provisionings_plan_fk", columns: [t.buildId, t.planVersion], foreignColumns: [plans.buildId, plans.version] }).onDelete("restrict"),
  foreignKey({ name: "device_provisionings_code_plan_fk", columns: [t.buildId, t.planVersion, t.codeVersion], foreignColumns: [codeBundles.buildId, codeBundles.planVersion, codeBundles.version] }).onDelete("restrict"),
  unique("device_provisionings_one_per_plan").on(t.buildId, t.planVersion),
  unique("device_provisionings_claim_request").on(t.tenantId, t.claimRequestId),
  check("device_provisionings_version_check", sql`${t.planVersion}>0 AND ${t.codeVersion}>0 AND ${t.credentialVersion}>0`),
  check("device_provisionings_sequence_check", sql`${t.seqStart}>=0 AND ${t.seqStart}<=9007199254740991`),
  check("device_provisionings_sealed_check", sql`(${t.handoffKeyId} IS NULL AND ${t.handoffNonce} IS NULL AND ${t.handoffCiphertext} IS NULL AND ${t.handoffTag} IS NULL) OR (${t.handoffKeyId} IS NOT NULL AND ${t.handoffNonce} IS NOT NULL AND ${t.handoffCiphertext} IS NOT NULL AND ${t.handoffTag} IS NOT NULL)`),
]);
