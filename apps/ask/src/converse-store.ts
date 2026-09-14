import type { Pool } from "pg";
import { TelemetryChannels, type DeviceConverseRequest } from "@albusforge/schema";
import { AskError } from "./errors";
import { authorize, transaction } from "./store";

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

export interface ConverseStore {
  context(q: DeviceConverseRequest, signal?: AbortSignal): Promise<DeviceContext>;
  window(q: DeviceConverseRequest, args: { channel: string; from: string; to: string }, signal?: AbortSignal): Promise<WindowFacts>;
  series(q: DeviceConverseRequest, args: { channel: string; from: string; to: string; resolution: "1m" | "1h" }, signal?: AbortSignal): Promise<SeriesFacts>;
}

/** `q` carries the trusted tenant/device; tool arguments never widen it. */
function scope(q: DeviceConverseRequest) {
  return { tenant_id: q.tenant_id, device_id: q.device_id, actor_id: q.actor_id };
}

function checkSpan(from: string, to: string) {
  const start = Date.parse(from),
    end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new AskError(400, "BAD_WINDOW", "Invalid time window");
  if (end <= start) throw new AskError(400, "BAD_WINDOW", "Window end must follow its start");
  if (end - start > LIMITS.spanMs) throw new AskError(422, "WINDOW_TOO_WIDE", "Window exceeds the supported span");
}

export function createConverseStore(pool: Pool): ConverseStore {
  return {
    context: (q, signal) =>
      transaction(
        pool,
        true,
        async (client) => {
          const channels = await authorize(client, scope(q));
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
