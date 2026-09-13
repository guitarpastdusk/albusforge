import type { Pool, PoolClient } from "pg";
import { SensorAskEvidence, TelemetryChannels, type SensorAskRequest } from "@albusforge/schema";
import type { LlmCallRecord } from "@albusforge/llm";
import { AskError } from "./errors";

export interface Limits { user: number; tenant: number; global: number }
export interface Store {
  evidence(request: SensorAskRequest, signal?: AbortSignal): Promise<SensorAskEvidence>;
  reserve(request: SensorAskRequest, signal?: AbortSignal): Promise<void>;
  started(request: SensorAskRequest, signal?: AbortSignal): Promise<void>;
  finish(request: SensorAskRequest, outcome: "model" | "evidence_only", usage?: LlmCallRecord, signal?: AbortSignal): Promise<void>;
}
async function authorize(client: PoolClient, q: SensorAskRequest) {
  const result = await client.query<{ channels: unknown }>(`SELECT d.channels FROM telemetry.devices d
    JOIN users.tenant_members m ON m.tenant_id=d.tenant_id
    WHERE d.tenant_id=$1 AND d.id=$2 AND m.user_id=$3`, [q.tenant_id, q.device_id, q.actor_id]);
  if (!result.rows[0]) throw new AskError(404, "NOT_FOUND", "Sensor not found");
  return TelemetryChannels.parse(result.rows[0].channels);
}
async function transaction<T>(pool: Pool, read: boolean, work: (client: PoolClient) => Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  let expired = false;
  let client: PoolClient | undefined;
  let released = false;
  const release = (destroy = false) => { if (client && !released) { released = true; client.release(destroy); } };
  const abort = () => { expired = true; release(true); };
  signal?.addEventListener("abort",abort,{once:true});
  try {
    // pg's bounded connectionTimeout also bounds pool queueing. A late lease is destroyed.
    client = await pool.connect();
    if (expired || signal?.aborted) { release(true); throw new AskError(503,"UNAVAILABLE","Sensor chat deadline reached"); }
    await client.query(read ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN");
    if (read) await client.query("LOCK TABLE ONLY telemetry.readings IN ACCESS SHARE MODE");
    const result = await work(client);
    signal?.throwIfAborted();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    if (client && !released) await client.query("ROLLBACK").catch(() => release(true));
    throw error;
  } finally { signal?.removeEventListener("abort",abort); release(); }
}
export function createStore(pool: Pool, limits: Limits): Store {
  return {
    evidence: (q,signal) => transaction(pool, true, async (client) => {
      const channels = await authorize(client, q);
      if (!Object.hasOwn(channels, q.channel)) throw new AskError(404, "NOT_FOUND", "Channel not found");
      const boundary = (await client.query<{ raw_before: Date }>("SELECT raw_before FROM telemetry.retention_state WHERE id=1")).rows[0];
      if (!boundary) throw new Error("Missing retention state");
      if (new Date(q.from) < boundary.raw_before) throw new AskError(410, "HISTORY_EXPIRED", "Requested raw history has expired");
      const rows = (await client.query<{ ts: Date; value: number }>(`SELECT r.ts,r.value FROM telemetry.readings r
        JOIN telemetry.devices d ON d.id=r.device_id WHERE d.tenant_id=$1 AND d.id=$2
        AND r.channel=$3 AND r.ts >= $4 AND r.ts < $5 ORDER BY r.ts,r.seq,r.ordinal LIMIT 10001`,
      [q.tenant_id,q.device_id,q.channel,q.from,q.to])).rows;
      if (rows.length > 10000) throw new AskError(422, "TOO_MANY_POINTS", "Choose a shorter window");
      // Incremental mean avoids sum overflow; never ask the model to do arithmetic.
      let mean = 0, min = Infinity, max = -Infinity;
      rows.forEach((r, index) => { mean = mean * (index / (index + 1)) + r.value / (index + 1); min = Math.min(min,r.value); max = Math.max(max,r.value); });
      const last = rows.at(-1);
      return SensorAskEvidence.parse({ from:q.from,to:q.to,unit:channels[q.channel]!.unit,count:rows.length,
        min:rows.length ? min:null,max:rows.length ? max:null,mean:rows.length ? mean:null,
        latest:last ? {t:last.ts.toISOString(),v:last.value}:null });
    },signal),
    reserve: (q,signal) => transaction(pool, false, async (client) => {
      // All instances reserve against one global lock; no model/network call holds it.
      await client.query("SELECT pg_advisory_xact_lock(1936028275,1)");
      const channels = await authorize(client,q);
      if (!Object.hasOwn(channels,q.channel)) throw new AskError(404,"NOT_FOUND","Channel not found");
      const duplicate = await client.query("SELECT 1 FROM telemetry.sensor_ask_requests WHERE request_id=$1",[q.request_id]);
      if (duplicate.rowCount) throw new AskError(409,"DUPLICATE_REQUEST","Request already accepted");
      const counts = (await client.query<{global:number;tenant:number;actor:number}>(`SELECT count(*)::int AS global,
        count(*) FILTER (WHERE tenant_id=$1)::int AS tenant,
        count(*) FILTER (WHERE actor_id=$2)::int AS actor
        FROM telemetry.sensor_ask_requests WHERE created_at > statement_timestamp()-interval '24 hours'`,[q.tenant_id,q.actor_id])).rows[0];
      if (counts!.global >= limits.global || counts!.tenant >= limits.tenant || counts!.actor >= limits.user)
        throw new AskError(429,"DAILY_LIMIT","Sensor chat daily request limit reached");
      await client.query("INSERT INTO telemetry.sensor_ask_requests(request_id,tenant_id,actor_id,device_id) VALUES($1,$2,$3,$4)",
        [q.request_id,q.tenant_id,q.actor_id,q.device_id]);
    },signal),
    async started(q,signal) {
      await transaction(pool,false,async (client) => { await client.query(
        "UPDATE telemetry.sensor_ask_requests SET model_attempted=true WHERE request_id=$1 AND tenant_id=$2 AND actor_id=$3 AND device_id=$4",
        [q.request_id,q.tenant_id,q.actor_id,q.device_id]); },signal);
    },
    async finish(q,outcome,usage,signal) {
      await transaction(pool,false,async (client) => { await client.query(`UPDATE telemetry.sensor_ask_requests SET outcome=$2,model=$3,usage_known=(NOT model_attempted OR $3::text IS NOT NULL),
        input_tokens=CASE WHEN model_attempted AND $3::text IS NULL THEN NULL ELSE $4::integer END,
        output_tokens=CASE WHEN model_attempted AND $3::text IS NULL THEN NULL ELSE $5::integer END,
        cache_read_tokens=CASE WHEN model_attempted AND $3::text IS NULL THEN NULL ELSE $6::integer END,
        cache_creation_tokens=CASE WHEN model_attempted AND $3::text IS NULL THEN NULL ELSE $7::integer END,
        cost_usd=CASE WHEN model_attempted AND $3::text IS NULL THEN NULL ELSE $8::numeric END
        WHERE request_id=$1 AND tenant_id=$9 AND actor_id=$10 AND device_id=$11`,
      [q.request_id,outcome,usage?.model ?? null,usage?.inputTokens ?? 0,usage?.outputTokens ?? 0,
        usage?.cacheReadInputTokens ?? 0,usage?.cacheCreationInputTokens ?? 0,usage?.costUsd ?? 0,q.tenant_id,q.actor_id,q.device_id]); },signal);
    },
  };
}
