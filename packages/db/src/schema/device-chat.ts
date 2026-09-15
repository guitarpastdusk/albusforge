import { sql } from "drizzle-orm";
import { boolean, check, index, integer, numeric, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { telemetrySchema, telemetryDevices } from "./telemetry.js";
import { tenants, users } from "./users.js";

/**
 * Per-request budget ledger for the multi-turn device chat, not conversation
 * history: nothing a person typed is stored here.
 *
 * Separate from `sensor_ask_requests` because the two paths cost differently
 * and cannot share a daily allowance. One ask turn is a single classifier
 * call; one chat turn is a tool loop of several frontier calls, so it is
 * metered per request with the model calls it actually made.
 */
export const deviceChatRequests = telemetrySchema.table("device_chat_requests", {
  requestId: uuid("request_id").primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  /**
   * Null for a turn taken on the public showcase, where there is no signed-in
   * caller at all. The check below makes that the only way it can be null, so
   * a public turn cannot carry an identity and an authenticated one cannot lack
   * it — the rule is the database's rather than the caller's to remember.
   */
  actorId: uuid("actor_id").references(() => users.id),
  /** A turn from the public surface. These share one allowance; see `public_budget`. */
  public: boolean("public").notNull().default(false),
  deviceId: uuid("device_id").notNull().references(() => telemetryDevices.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`statement_timestamp()`),
  outcome: text("outcome").notNull().default("reserved"),
  model: text("model"),
  modelAttempted: boolean("model_attempted").notNull().default(false),
  /** Model calls in the loop, and tools they ran. Both bounded by configuration. */
  modelCalls: smallint("model_calls").notNull().default(0),
  toolCalls: smallint("tool_calls").notNull().default(0),
  /** False when a call was attempted but its usage never came back; the cost is real but unknown. */
  usageKnown: boolean("usage_known").notNull().default(false),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  cacheReadTokens: integer("cache_read_tokens"),
  cacheCreationTokens: integer("cache_creation_tokens"),
  costUsd: numeric("cost_usd", { precision: 16, scale: 6 }),
}, (t) => [
  index("device_chat_tenant_window").on(t.tenantId, t.createdAt),
  index("device_chat_actor_window").on(t.actorId, t.createdAt),
  index("device_chat_public_window").on(t.createdAt).where(sql`${t.public}`),
  index("device_chat_global_window").on(t.createdAt),
  check("device_chat_identity", sql`(${t.public} AND ${t.actorId} IS NULL) OR (NOT ${t.public} AND ${t.actorId} IS NOT NULL)`),
  check("device_chat_outcome", sql`${t.outcome} IN ('reserved','model','no_tool','unavailable','failed')`),
  check("device_chat_input", sql`${t.inputTokens} >= 0`),
  check("device_chat_output", sql`${t.outputTokens} >= 0`),
  check("device_chat_cache_read", sql`${t.cacheReadTokens} >= 0`),
  check("device_chat_cache_creation", sql`${t.cacheCreationTokens} >= 0`),
  check("device_chat_cost", sql`${t.costUsd} >= 0`),
  check("device_chat_model_calls", sql`${t.modelCalls} >= 0`),
  check("device_chat_tool_calls", sql`${t.toolCalls} >= 0`),
]);
