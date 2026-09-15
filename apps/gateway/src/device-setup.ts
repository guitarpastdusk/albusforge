import { DeviceSetupParams, DeviceSetupStatus, ProvisionedChannels, routes } from "@albusforge/schema";
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
      const provisioned = ProvisionedChannels.parse(row.channels);
      const latest = (await client.query<{ channel: string; ts: Date; value: number }>(`SELECT l.channel,l.ts,l.value FROM telemetry.latest l
        JOIN telemetry.devices d ON d.id=l.device_id WHERE d.tenant_id=$1 AND d.id=$2 AND l.channel=ANY($3::text[]) ORDER BY l.channel LIMIT 64`, [tenantId, id, Object.keys(provisioned)])).rows;
      const channels = Object.entries(provisioned).sort(([a], [b]) => a.localeCompare(b)).map(([key, channel]) => {
        const sample = latest.find(item => item.channel === key);
        return { key, unit: channel.unit, latest: sample ? { at: sample.ts.toISOString(), value: sample.value } : null };
      });
      const capabilities = (await client.query<{ id: string; kind: string; schema: string; enabled: boolean; required: boolean; interval_s: number; last_capture_at: Date | null; last_received_at: Date | null; status: string; numeric_channels: Record<string, unknown> | null }>(`SELECT c.capability_id AS id,c.kind,c.payload_schema AS schema,c.enabled,c.required,c.interval_s,c.channels AS numeric_channels,p.last_capture_at,p.last_received_at,
        CASE WHEN NOT c.enabled THEN 'disabled' WHEN p.last_received_at IS NULL THEN 'waiting'
        WHEN LEAST(p.last_received_at,p.last_capture_at)>=statement_timestamp()-make_interval(secs=>CASE WHEN c.kind='image' THEN c.interval_s*2+300 ELSE GREATEST(60,c.interval_s*3) END) THEN 'healthy' ELSE 'stale' END AS status
        FROM telemetry.device_capabilities c LEFT JOIN telemetry.capability_presence p USING(device_id,capability_id)
        WHERE c.device_id=$1 ORDER BY c.capability_id LIMIT 64`, [id])).rows;
      const required = capabilities.filter(c => c.required);
      const pendingCapabilities = required.some(c => !c.last_received_at);
      const requiredChannels = new Set(capabilities.length
        ? required.filter(c => c.kind === "measurement").flatMap(c => Object.keys(c.numeric_channels ?? {}))
        : channels.map(c => c.key));
      const received = row.packet_received || capabilities.some(c => c.last_received_at !== null);
      const state = row.revoked_at ? "credential_revoked" : required.some(c => !c.enabled) ? "degraded" : !received ? "waiting_for_upload"
        : channels.some(c => requiredChannels.has(c.key) && c.latest === null) ? "waiting_for_channels"
        : pendingCapabilities ? "waiting_for_capabilities" : required.some(c => c.status === "stale") ? "degraded" : "confirmed";
      return DeviceSetupStatus.parse({
        device_id: row.id, checked_at: row.checked_at.toISOString(), registered_at: row.created_at.toISOString(),
        state,
        ...(capabilities.length ? { capabilities: capabilities.map(c => ({ id: c.id, kind: c.kind, schema: c.schema, enabled: c.enabled, required: c.required, interval_s: c.interval_s, status: c.status, last_capture_at: c.last_capture_at?.toISOString() ?? null, last_received_at: c.last_received_at?.toISOString() ?? null })) } : {}),
        packet_received: row.packet_received, last_packet_at: row.last_seen_at?.toISOString() ?? null,
        upload_interval_s: row.next_s, revoked_at: row.revoked_at?.toISOString() ?? null, channels,
      });
    }));
  });
}
