import {
  ProvisionedChannels,
  TelemetryDeviceDetail,
  TelemetryDeviceParams,
  TelemetryDeviceQuery,
  TelemetryFleetPage,
  TelemetryFleetQuery,
  TelemetryHistory,
  TelemetryLatest,
  TelemetrySeriesQuery,
  TelemetryMetadataRequest,
  routes,
} from "@albusforge/schema";
import type { FastifyInstance } from "fastify";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { HttpError, parse } from "./http";
import { assertSameOrigin } from "./mutation-origin";
import { updateDeviceMetadata } from "./telemetry-metadata";
import { withSession } from "./session";

// Explicit public projection: source snapshots and token hashes never leave SQL.
const RECEIVED = `GREATEST(last_seen_at,(SELECT max(p.last_received_at) FROM telemetry.capability_presence p WHERE p.device_id=devices.id))`;
const STALE = `EXISTS(SELECT 1 FROM telemetry.device_capabilities c LEFT JOIN telemetry.capability_presence p USING(device_id,capability_id)
  WHERE c.device_id=devices.id AND c.required AND (NOT c.enabled OR p.last_received_at IS NULL OR LEAST(p.last_received_at,p.last_capture_at)<CURRENT_TIMESTAMP-make_interval(secs=>CASE WHEN c.kind='image' THEN c.interval_s*2+300 ELSE GREATEST(60,c.interval_s*3) END)))`;
const HAS_CAPABILITIES = `EXISTS(SELECT 1 FROM telemetry.device_capabilities c WHERE c.device_id=devices.id)`;
const HAS_REQUIRED = `EXISTS(SELECT 1 FROM telemetry.device_capabilities c WHERE c.device_id=devices.id AND c.required)`;
const HEALTHY_SOURCE = `EXISTS(SELECT 1 FROM telemetry.device_capabilities c JOIN telemetry.capability_presence p USING(device_id,capability_id)
  WHERE c.device_id=devices.id AND c.enabled AND LEAST(p.last_received_at,p.last_capture_at)>=CURRENT_TIMESTAMP-make_interval(secs=>CASE WHEN c.kind='image' THEN c.interval_s*2+300 ELSE GREATEST(60,c.interval_s*3) END))`;
const DEVICE_COLUMNS = `id,display_name,metadata_version,channels,next_s,revoked_at,${RECEIVED} AS last_seen_at,status AS health,
  CASE WHEN ${RECEIVED} IS NULL THEN 'never_seen'
    WHEN revoked_at IS NOT NULL OR ${STALE} THEN 'offline'
    WHEN ${HAS_CAPABILITIES} THEN CASE WHEN ${HAS_REQUIRED} OR ${HEALTHY_SOURCE} THEN 'online' ELSE 'offline' END
    WHEN ${RECEIVED} >= CURRENT_TIMESTAMP - make_interval(secs => greatest(60,next_s*3)) THEN 'online'
    ELSE 'offline' END AS status`;
interface DeviceRow {
  display_name: string | null;
  metadata_version: number;
  id: string;
  channels: unknown;
  next_s: number;
  revoked_at: Date | null;
  last_seen_at: Date | null;
  health: unknown;
  status: string;
}
const state = (row: DeviceRow, presentation = false) => ({
  ...(presentation
    ? { display_name: row.display_name, metadata_version: row.metadata_version }
    : {}),
  id: row.id,
  next_s: row.next_s,
  revoked_at: row.revoked_at?.toISOString() ?? null,
  last_seen_at: row.last_seen_at?.toISOString() ?? null,
  health: row.health,
  status: row.status,
});
async function device(
  client: PoolClient,
  tenant: string,
  id: string,
): Promise<DeviceRow> {
  const row = (
    await client.query<DeviceRow>(
      `SELECT ${DEVICE_COLUMNS} FROM telemetry.devices WHERE tenant_id=$1 AND id=$2`,
      [tenant, id],
    )
  ).rows[0];
  if (!row) throw new HttpError(404, "NOT_FOUND", "Device not found");
  return row;
}

export function registerTelemetryReads(app: FastifyInstance, pool: Pool) {
  app.register(async (scope) => {
    // Applies to successes and authentication/validation/storage errors alike.
    scope.addHook("onRequest", async (_request, reply) => {
      reply.header("cache-control", "private, no-store");
    });
    scope.patch(routes.telemetry.metadata.pattern, async (request) => {
      assertSameOrigin(request);
      parse(z.strictObject({}), request.query, "query");
      const { id } = parse(TelemetryDeviceParams, request.params, "device id");
      const body = parse(
        TelemetryMetadataRequest,
        request.body,
        "request body",
      );
      return updateDeviceMetadata(
        pool,
        request.headers.cookie,
        request.hostname,
        id,
        body,
      );
    });
    scope.get(routes.telemetry.devices.pattern, async (request) =>
      withSession(
        pool,
        request.headers.cookie,
        request.hostname,
        async (client, tenant) => {
          const query = parse(TelemetryFleetQuery, request.query, "query");
          const rows = (
            await client.query<DeviceRow>(
              `SELECT * FROM (SELECT ${DEVICE_COLUMNS} FROM telemetry.devices
        WHERE tenant_id=$1 AND ($2::uuid IS NULL OR id > $2)
          AND ($4::text IS NULL OR position(lower($4) in lower(coalesce(display_name,'')))>0 OR position(lower($4) in id::text)>0)) fleet
        WHERE $5::text IS NULL OR (CASE WHEN revoked_at IS NOT NULL THEN 'revoked' ELSE status END)=$5
        ORDER BY id LIMIT $3`,
              [
                tenant,
                query.after ?? null,
                query.limit + 1,
                query.q || null,
                query.status ?? null,
              ],
            )
          ).rows;
          const page = rows.slice(0, query.limit);
          return TelemetryFleetPage.parse({
            devices: page.map((row) => state(row, query.presentation === "1")),
            next_after: rows.length > query.limit ? page.at(-1)!.id : null,
          });
        },
      ),
    );
    scope.get(routes.telemetry.device.pattern, async (request) =>
      withSession(
        pool,
        request.headers.cookie,
        request.hostname,
        async (client, tenant, user) => {
          const query = parse(TelemetryDeviceQuery, request.query, "query");
          const { id } = parse(
            TelemetryDeviceParams,
            request.params,
            "device id",
          );
          const row = await device(client, tenant, id);
          const member = (
            await client.query<{ role: string }>(
              "SELECT role FROM users.tenant_members WHERE tenant_id=$1 AND user_id=$2",
              [tenant, user],
            )
          ).rows[0];
          const capabilities = (await client.query(`SELECT c.capability_id AS id,c.kind,c.payload_schema AS schema,c.enabled,c.required,c.interval_s,p.last_capture_at,p.last_received_at,
            CASE WHEN d.revoked_at IS NOT NULL THEN 'credential_revoked' WHEN NOT c.enabled THEN 'disabled' WHEN p.last_received_at IS NULL THEN 'waiting'
            WHEN LEAST(p.last_received_at,p.last_capture_at)>=statement_timestamp()-make_interval(secs=>CASE WHEN c.kind='image' THEN c.interval_s*2+300 ELSE GREATEST(60,c.interval_s*3) END) THEN 'healthy' ELSE 'stale' END AS status
            FROM telemetry.device_capabilities c JOIN telemetry.devices d ON d.id=c.device_id LEFT JOIN telemetry.capability_presence p USING(device_id,capability_id)
            WHERE c.device_id=$1 ORDER BY c.capability_id LIMIT 64`, [id])).rows.map(c => ({ ...c, last_capture_at: c.last_capture_at?.toISOString() ?? null, last_received_at: c.last_received_at?.toISOString() ?? null }));
          return TelemetryDeviceDetail.parse({
            device: state(row, query.presentation === "1"),
            channels: row.channels,
            ...(capabilities.length ? { capabilities } : {}),
            ...(query.presentation === "1"
              ? {
                  permissions: {
                    edit_metadata:
                      member?.role === "admin" || member?.role === "operator",
                  },
                }
              : {}),
          });
        },
      ),
    );
    scope.get(routes.telemetry.latest.pattern, async (request) =>
      withSession(
        pool,
        request.headers.cookie,
        request.hostname,
        async (client, tenant) => {
          parse(z.strictObject({}), request.query, "query");
          const { id } = parse(
            TelemetryDeviceParams,
            request.params,
            "device id",
          );
          await device(client, tenant, id);
          const rows = (
            await client.query<{
              channel: string;
              ts: Date;
              value: number;
              seq: string;
              ordinal: number;
            }>(
              `SELECT l.channel,l.ts,l.value,l.seq::text,l.ordinal
        FROM telemetry.latest l JOIN telemetry.devices d ON d.id=l.device_id
        WHERE d.tenant_id=$1 AND d.id=$2 ORDER BY l.channel LIMIT 65`,
              [tenant, id],
            )
          ).rows;
          return TelemetryLatest.parse({
            device_id: id,
            readings: rows.map((r) => ({
              channel: r.channel,
              t: r.ts.toISOString(),
              v: r.value,
              seq: r.seq,
              ordinal: r.ordinal,
            })),
          });
        },
      ),
    );
    scope.get(routes.telemetry.series.pattern, async (request) =>
      withSession(
        pool,
        request.headers.cookie,
        request.hostname,
        async (client, tenant) => {
          const { id } = parse(
            TelemetryDeviceParams,
            request.params,
            "device id",
          );
          const q = parse(TelemetrySeriesQuery, request.query, "query");
          const row = await device(client, tenant, id);
          if (!Object.hasOwn(ProvisionedChannels.parse(row.channels), q.channel))
            throw new HttpError(404, "NOT_FOUND", "Channel not found");
          const boundary = (
            await client.query<{
              raw_before: Date;
              minute_before: Date;
            }>(`SELECT raw_before,
        date_trunc('day',statement_timestamp(),'UTC')-interval '7 days' AS minute_before FROM telemetry.retention_state WHERE id=1`)
          ).rows[0];
          if (!boundary) throw new Error("Telemetry retention state missing");
          const start = new Date(q.from),
            end = new Date(q.to);
          const earliest =
            q.resolution === "raw"
              ? boundary.raw_before
              : q.resolution === "1m"
                ? boundary.minute_before
                : null;
          if (earliest && start < earliest)
            throw new HttpError(
              410,
              "HISTORY_EXPIRED",
              "Requested resolution is outside retention",
              { available_from: earliest.toISOString() },
            );
          const args = [tenant, id, q.channel, start, end, q.limit + 1];
          let points: unknown[];
          if (q.resolution === "raw") {
            const rows = (
              await client.query<{
                ts: Date;
                value: number;
                seq: string;
                ordinal: number;
              }>(
                `SELECT r.ts,r.value,r.seq::text,r.ordinal
          FROM telemetry.readings r JOIN telemetry.devices d ON d.id=r.device_id
          WHERE d.tenant_id=$1 AND d.id=$2 AND r.channel=$3 AND r.ts >= $4 AND r.ts < $5
          ORDER BY r.ts,r.seq,r.ordinal LIMIT $6`,
                args,
              )
            ).rows;
            points = rows.map((r) => ({
              t: r.ts.toISOString(),
              v: r.value,
              seq: r.seq,
              ordinal: r.ordinal,
            }));
          } else {
            const rows = (
              await client.query<{
                bucket: Date;
                v: number;
                n: string;
                sum: string;
                min: number;
                max: number;
                last: number;
                stddev: string;
              }>(
                `SELECT r.bucket,(r.sum/NULLIF(r.n,0))::double precision AS v,
          r.n::text,r.sum::text,r.min,r.max,r.last,r.stddev::text
          FROM telemetry.rollups r JOIN telemetry.devices d ON d.id=r.device_id
          WHERE d.tenant_id=$1 AND d.id=$2 AND r.channel=$3 AND r.bucket >= $4 AND r.bucket < $5 AND r.resolution=$7
          ORDER BY r.bucket LIMIT $6`,
                [...args, q.resolution],
              )
            ).rows;
            points = rows.map(({ bucket, ...r }) => ({
              t: bucket.toISOString(),
              ...r,
            }));
          }
          if (points.length > q.limit)
            throw new HttpError(
              422,
              "TOO_MANY_POINTS",
              "Use a narrower window, coarser resolution or higher limit",
            );
          const pending =
            q.resolution !== "raw" &&
            (
              await client.query(
                `SELECT 1 FROM telemetry.dirty_hours h
        JOIN telemetry.devices d ON d.id=h.device_id WHERE d.tenant_id=$1 AND d.id=$2 AND h.channel=$3
        AND h.bucket < $5 AND h.bucket+interval '1 hour' > $4 LIMIT 1`,
                args.slice(0, 5),
              )
            ).rowCount !== 0;
          return TelemetryHistory.parse({
            device_id: id,
            channel: q.channel,
            from: start.toISOString(),
            to: end.toISOString(),
            resolution: q.resolution,
            pending_rollup: pending,
            points,
          });
        },
        { historyLayout: true },
      ),
    );
  });
}
