import { sql } from "drizzle-orm";
import { boolean, check, index, integer, numeric, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { telemetrySchema,telemetryDevices } from "./telemetry.js";
import { tenants,users } from "./users.js";
/** Durable per-request budget/usage ledger, not conversation history. */
export const sensorAskRequests = telemetrySchema.table("sensor_ask_requests",{
  requestId:uuid("request_id").primaryKey(),
  tenantId:uuid("tenant_id").notNull().references(()=>tenants.id),
  actorId:uuid("actor_id").notNull().references(()=>users.id),
  deviceId:uuid("device_id").notNull().references(()=>telemetryDevices.id),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().default(sql`statement_timestamp()`),
  outcome:text("outcome").notNull().default("reserved"),
  model:text("model"),
  modelAttempted:boolean("model_attempted").notNull().default(false),
  usageKnown:boolean("usage_known").notNull().default(false),
  inputTokens:integer("input_tokens"),
  outputTokens:integer("output_tokens"),
  cacheReadTokens:integer("cache_read_tokens"),
  cacheCreationTokens:integer("cache_creation_tokens"),
  costUsd:numeric("cost_usd",{precision:16,scale:6}),
},t=>[index("sensor_ask_tenant_window").on(t.tenantId,t.createdAt),index("sensor_ask_global_window").on(t.createdAt),
  check("sensor_ask_outcome",sql`${t.outcome} IN ('reserved','model','evidence_only','failed')`),
  check("sensor_ask_input",sql`${t.inputTokens} >= 0`),check("sensor_ask_output",sql`${t.outputTokens} >= 0`),
  check("sensor_ask_cache_read",sql`${t.cacheReadTokens} >= 0`),check("sensor_ask_cache_creation",sql`${t.cacheCreationTokens} >= 0`),
  check("sensor_ask_cost",sql`${t.costUsd} >= 0`)]);
