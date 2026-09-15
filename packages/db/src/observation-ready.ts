import type { Pool } from "pg";
/** Exact schema used by upload recovery, capability reads and numeric presence. */
export async function assertObservationSchema(pool: Pool): Promise<void> {
  await pool.query(`SELECT r.reservation_credential_hash,r.maintenance_checked_at,c.capability_id,p.last_received_at,m.orphan_page_token,c.monitoring_started_at,m.health_device_cursor,m.health_capability_cursor,m.health_scan_started_at,m.health_enabled_count,m.health_stale_count
    FROM telemetry.observation_receipts r CROSS JOIN telemetry.device_capabilities c
    CROSS JOIN telemetry.capability_presence p CROSS JOIN telemetry.observation_maintenance_state m LIMIT 0`);
}
