import { DeviceSetupParams, DeviceSetupStatus, TelemetryChannels, routes } from "@albusforge/schema";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { HttpError, parse } from "./http";
import { withSession } from "./session";

/** No enrollment or credential writes: only the active tenant's registered device. */
export function registerDeviceSetup(app: FastifyInstance, pool: Pool) {
  app.register(async scope => {
    scope.addHook("onRequest", async (_request, reply) => { reply.header("cache-control", "private, no-store"); });
    scope.get(routes.deviceSetup.status.pattern, async request => withSession(pool, request.headers.cookie, request.hostname, async (client, tenantId) => {
      const { id } = parse(DeviceSetupParams, request.params, "device id");
      parse(z.strictObject({}), request.query, "query");
      // Exact public projection. Neither credential hashes nor private source snapshots leave SQL.
      // Receipt EXISTS is an indexed device-prefix lookup, not an all-history count/min scan.
      const row = (await client.query<{
        id: string; channels: unknown; created_at: Date; revoked_at: Date | null;
        last_seen_at: Date | null; next_s: number; checked_at: Date; packet_received: boolean;
      }>(`SELECT d.id,d.channels,d.created_at,d.revoked_at,d.last_seen_at,d.next_s,statement_timestamp() AS checked_at,
        EXISTS(SELECT 1 FROM telemetry.packets p WHERE p.device_id=d.id) AS packet_received
        FROM telemetry.devices d WHERE d.tenant_id=$1 AND d.id=$2`, [tenantId, id])).rows[0];
      if (!row) throw new HttpError(404, "NOT_FOUND", "Device not found");
      const provisioned = TelemetryChannels.parse(row.channels);
      const latest = (await client.query<{ channel: string; ts: Date; value: number }>(`SELECT l.channel,l.ts,l.value FROM telemetry.latest l
        JOIN telemetry.devices d ON d.id=l.device_id WHERE d.tenant_id=$1 AND d.id=$2 AND l.channel=ANY($3::text[]) ORDER BY l.channel LIMIT 64`, [tenantId, id, Object.keys(provisioned)])).rows;
      const channels = Object.entries(provisioned).sort(([a], [b]) => a.localeCompare(b)).map(([key, channel]) => {
        const sample = latest.find(item => item.channel === key);
        return { key, unit: channel.unit, latest: sample ? { at: sample.ts.toISOString(), value: sample.value } : null };
      });
      return DeviceSetupStatus.parse({
        device_id: row.id, checked_at: row.checked_at.toISOString(), registered_at: row.created_at.toISOString(),
        state: row.revoked_at ? "credential_revoked" : !row.packet_received ? "waiting_for_upload" : channels.some(channel => channel.latest === null) ? "waiting_for_channels" : "confirmed",
        packet_received: row.packet_received, last_packet_at: row.last_seen_at?.toISOString() ?? null,
        upload_interval_s: row.next_s, revoked_at: row.revoked_at?.toISOString() ?? null, channels,
      });
    }));
  });
}
