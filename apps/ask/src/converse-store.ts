import type { Pool, PoolClient } from "pg";
import { TelemetryChannels, type DeviceConverseRequest } from "@albusforge/schema";
import { AskError, AskQuotaError } from "./errors";
import { authorize, authorizePublic, transaction } from "./store";

/** Bounds enforced here, not in the prompt: a model asking for more gets an error result, not more data. */
export const LIMITS = {
  /** Raw rows a single window may scan. */
  windowRows: 20000,
  /** Points a series may return to the model. Keeps a tool result small enough to re-send every iteration. */
  seriesPoints: 200,
  /** Widest window, in ms, for any single call. */
  spanMs: 32 * 86400_000,
} as const;

export interface ChannelFacts {
  channel: string;
  unit: string;
  latest: { t: string; v: number } | null;
}
export interface DeviceContext {
  device_id: string;
  display_name: string | null;
  status: "online" | "offline" | "never_seen";
  last_seen_at: string | null;
  next_s: number;
  revoked: boolean;
  health: { batt_mv?: number; rssi?: number; health?: string[] } | null;
  channels: ChannelFacts[];
  /** Oldest raw reading still retained. Older windows return no rows, which is not the same as no readings. */
  raw_before: string;
  now: string;
}
export interface WindowFacts {
  channel: string;
  unit: string;
  from: string;
  to: string;
  count: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  latest: { t: string; v: number } | null;
}
export interface SeriesFacts {
  channel: string;
  unit: string;
  resolution: "1m" | "1h";
  points: { t: string; mean: number; min: number; max: number; n: number }[];
  truncated: boolean;
}

/** Daily allowances, counted over a rolling 24 hours. Separate from the classifier's. */
export interface ChatLimits { user: number; tenant: number; global: number }

/** What a finished turn cost, summed across every model call the loop made. */
export interface ChatUsage {
  model: string | null;
  modelCalls: number;
  toolCalls: number;
  /** False when a call was attempted but no usage came back: the spend is real and unknown. */
  usageKnown: boolean;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
}

export interface ConverseStore {
  /** Admits the turn against the daily allowances, or refuses before a paid call is made. */
  reserve(q: DeviceConverseRequest, signal?: AbortSignal): Promise<void>;
  /** Marks that a model call is about to be attempted, so an unknown-usage turn is still visible. */
  started(q: DeviceConverseRequest, signal?: AbortSignal): Promise<void>;
  finish(q: DeviceConverseRequest, outcome: "model" | "no_tool" | "unavailable" | "failed", usage: ChatUsage, signal?: AbortSignal): Promise<void>;
  context(q: DeviceConverseRequest, signal?: AbortSignal): Promise<DeviceContext>;
  window(q: DeviceConverseRequest, args: { channel: string; from: string; to: string }, signal?: AbortSignal): Promise<WindowFacts>;
  series(q: DeviceConverseRequest, args: { channel: string; from: string; to: string; resolution: "1m" | "1h" }, signal?: AbortSignal): Promise<SeriesFacts>;
}

/** `q` carries the trusted tenant/device; tool arguments never widen it. */
/**
 * Authorizes the turn the way its own identity requires: a signed-in turn
 * checks the caller's membership, a public one checks only that the device
 * belongs to the pinned tenant. Narrowed on `actor_id` rather than on `public`
 * so the membership check cannot be reached without an actor to check.
 */
function authorizeTurn(client: PoolClient, q: DeviceConverseRequest) {
  return q.actor_id === null
    ? authorizePublic(client, { tenant_id: q.tenant_id, device_id: q.device_id })
    : authorize(client, { tenant_id: q.tenant_id, device_id: q.device_id, actor_id: q.actor_id });
}

function checkSpan(from: string, to: string) {
  const start = Date.parse(from),
    end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new AskError(400, "BAD_WINDOW", "Invalid time window");
  if (end <= start) throw new AskError(400, "BAD_WINDOW", "Window end must follow its start");
  if (end - start > LIMITS.spanMs) throw new AskError(422, "WINDOW_TOO_WIDE", "Window exceeds the supported span");
}

/** Its own lock key, so a chat reservation never serializes behind an ask one. */
const CHAT_LOCK = 1936028276;

export function createConverseStore(pool: Pool, limits: ChatLimits): ConverseStore {
  return {
    reserve: (q, signal) =>
      transaction(
        pool,
        false,
        async (client) => {
          // One global lock across instances, held only for this counting read
          // and insert. No model or network call ever runs inside it.
          await client.query("SELECT pg_advisory_xact_lock($1,1)", [CHAT_LOCK]);
          await authorizeTurn(client, q);
          const duplicate = await client.query("SELECT 1 FROM telemetry.device_chat_requests WHERE request_id=$1", [q.request_id]);
          if (duplicate.rowCount) throw new AskError(409, "DUPLICATE_REQUEST", "Request already accepted");
          const counts = (
            await client.query<{ global: number; tenant: number; actor: number }>(
              // The public bucket is every anonymous turn together, counted
              // against the same per-actor allowance: one visitor cannot spend
              // more than a signed-in person, and all of them share that.
              `SELECT count(*)::int AS global,
                 count(*) FILTER (WHERE tenant_id=$1)::int AS tenant,
                 count(*) FILTER (WHERE CASE WHEN $3::boolean THEN public ELSE actor_id=$2 END)::int AS actor
               FROM telemetry.device_chat_requests WHERE created_at > statement_timestamp()-interval '24 hours'`,
              [q.tenant_id, q.actor_id, q.public],
            )
          ).rows[0]!;
          // Widest scope first, so an operator reading the diagnostic learns
          // whether the tenant or the platform is out of headroom.
          if (counts.global >= limits.global) throw new AskQuotaError("global");
          if (counts.tenant >= limits.tenant) throw new AskQuotaError("tenant");
          if (counts.actor >= limits.user) throw new AskQuotaError("actor");
          await client.query(
            "INSERT INTO telemetry.device_chat_requests(request_id,tenant_id,actor_id,public,device_id) VALUES($1,$2,$3,$4,$5)",
            [q.request_id, q.tenant_id, q.actor_id, q.public, q.device_id],
          );
        },
        signal,
      ),

    started: (q, signal) =>
      transaction(
        pool,
        false,
        async (client) => {
          await client.query(
            "UPDATE telemetry.device_chat_requests SET model_attempted=true WHERE request_id=$1 AND tenant_id=$2 AND actor_id IS NOT DISTINCT FROM $3 AND device_id=$4",
            [q.request_id, q.tenant_id, q.actor_id, q.device_id],
          );
        },
        signal,
      ),

    finish: (q, outcome, usage, signal) =>
      transaction(
        pool,
        false,
        async (client) => {
          await client.query(
            `UPDATE telemetry.device_chat_requests
               SET outcome=$2,model=$3,model_calls=$4,tool_calls=$5,
                   usage_known=(NOT model_attempted OR $6::boolean),
                   input_tokens=CASE WHEN model_attempted AND NOT $6::boolean THEN NULL ELSE $7::integer END,
                   output_tokens=CASE WHEN model_attempted AND NOT $6::boolean THEN NULL ELSE $8::integer END,
                   cache_read_tokens=CASE WHEN model_attempted AND NOT $6::boolean THEN NULL ELSE $9::integer END,
                   cache_creation_tokens=CASE WHEN model_attempted AND NOT $6::boolean THEN NULL ELSE $10::integer END,
                   cost_usd=CASE WHEN model_attempted AND NOT $6::boolean THEN NULL ELSE $11::numeric END
             WHERE request_id=$1 AND tenant_id=$12 AND actor_id IS NOT DISTINCT FROM $13 AND device_id=$14`,
            [q.request_id, outcome, usage.model, usage.modelCalls, usage.toolCalls, usage.usageKnown,
              usage.inputTokens, usage.outputTokens, usage.cacheReadTokens, usage.cacheCreationTokens, usage.costUsd,
              q.tenant_id, q.actor_id, q.device_id],
          );
        },
        signal,
      ),

    context: (q, signal) =>
      transaction(
        pool,
        true,
        async (client) => {
          const channels = await authorizeTurn(client, q);
          const device = (
            await client.query<{
              display_name: string | null;
              last_seen_at: Date | null;
              next_s: number;
              revoked_at: Date | null;
              status: unknown;
            }>(
              `SELECT display_name,last_seen_at,next_s,revoked_at,status FROM telemetry.devices WHERE id=$1 AND tenant_id=$2`,
              [q.device_id, q.tenant_id],
            )
          ).rows[0];
          if (!device) throw new AskError(404, "NOT_FOUND", "Device not found");
          const latest = (
            await client.query<{ channel: string; ts: Date; value: number }>(
              `SELECT channel,ts,value FROM telemetry.latest WHERE device_id=$1`,
              [q.device_id],
            )
          ).rows;
          const boundary = (await client.query<{ raw_before: Date }>("SELECT raw_before FROM telemetry.retention_state WHERE id=1")).rows[0];
          if (!boundary) throw new Error("Missing retention state");
          const now = new Date();
          const seen = device.last_seen_at;
          const stale = Math.max(60, device.next_s * 3) * 1000;
          const health = (device.status ?? null) as DeviceContext["health"];
          return {
            device_id: q.device_id,
            display_name: device.display_name,
            status: !seen ? "never_seen" : now.getTime() - seen.getTime() <= stale ? "online" : "offline",
            last_seen_at: seen ? seen.toISOString() : null,
            next_s: device.next_s,
            revoked: Boolean(device.revoked_at),
            health,
            channels: Object.entries(channels).map(([channel, meta]) => {
              const sample = latest.find((row) => row.channel === channel);
              return { channel, unit: meta.unit, latest: sample ? { t: sample.ts.toISOString(), v: sample.value } : null };
            }),
            raw_before: boundary.raw_before.toISOString(),
            now: now.toISOString(),
          } satisfies DeviceContext;
        },
        signal,
      ),

    window: (q, args, signal) =>
      transaction(
        pool,
        true,
        async (client) => {
          checkSpan(args.from, args.to);
          const channels = TelemetryChannels.parse(
            (await client.query<{ channels: unknown }>(`SELECT channels FROM telemetry.devices WHERE id=$1 AND tenant_id=$2`, [q.device_id, q.tenant_id])).rows[0]
              ?.channels ?? {},
          );
          const meta = channels[args.channel];
          if (!meta) throw new AskError(404, "NO_SUCH_CHANNEL", "This device has no such channel");
          const rows = (
            await client.query<{ ts: Date; value: number }>(
              `SELECT r.ts,r.value FROM telemetry.readings r JOIN telemetry.devices d ON d.id=r.device_id
               WHERE d.tenant_id=$1 AND d.id=$2 AND r.channel=$3 AND r.ts >= $4 AND r.ts < $5
               ORDER BY r.ts,r.seq,r.ordinal LIMIT ${LIMITS.windowRows + 1}`,
              [q.tenant_id, q.device_id, args.channel, args.from, args.to],
            )
          ).rows;
          if (rows.length > LIMITS.windowRows) throw new AskError(422, "TOO_MANY_POINTS", "Window holds too many readings");
          // Incremental mean: never ask the model to do arithmetic, and never overflow a sum.
          let mean = 0,
            min = Infinity,
            max = -Infinity;
          rows.forEach((row, index) => {
            mean = mean * (index / (index + 1)) + row.value / (index + 1);
            min = Math.min(min, row.value);
            max = Math.max(max, row.value);
          });
          const last = rows.at(-1);
          return {
            channel: args.channel,
            unit: meta.unit,
            from: args.from,
            to: args.to,
            count: rows.length,
            min: rows.length ? min : null,
            max: rows.length ? max : null,
            mean: rows.length ? mean : null,
            latest: last ? { t: last.ts.toISOString(), v: last.value } : null,
          } satisfies WindowFacts;
        },
        signal,
      ),

    series: (q, args, signal) =>
      transaction(
        pool,
        true,
        async (client) => {
          checkSpan(args.from, args.to);
          const channels = TelemetryChannels.parse(
            (await client.query<{ channels: unknown }>(`SELECT channels FROM telemetry.devices WHERE id=$1 AND tenant_id=$2`, [q.device_id, q.tenant_id])).rows[0]
              ?.channels ?? {},
          );
          const meta = channels[args.channel];
          if (!meta) throw new AskError(404, "NO_SUCH_CHANNEL", "This device has no such channel");
          const rows = (
            await client.query<{ bucket: Date; n: string; sum: string; min: number; max: number }>(
              `SELECT bucket,n,sum,min,max FROM telemetry.rollups
               WHERE device_id=$1 AND channel=$2 AND resolution=$3 AND bucket >= $4 AND bucket < $5
               ORDER BY bucket LIMIT ${LIMITS.seriesPoints + 1}`,
              [q.device_id, args.channel, args.resolution, args.from, args.to],
            )
          ).rows;
          const truncated = rows.length > LIMITS.seriesPoints;
          return {
            channel: args.channel,
            unit: meta.unit,
            resolution: args.resolution,
            points: rows.slice(0, LIMITS.seriesPoints).map((row) => ({
              t: row.bucket.toISOString(),
              mean: Number(row.sum) / Number(row.n),
              min: row.min,
              max: row.max,
              n: Number(row.n),
            })),
            truncated,
          } satisfies SeriesFacts;
        },
        signal,
      ),
  };
}
