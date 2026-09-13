import type pg from "pg";

/** One MVCC snapshot, no tenant identifiers or readings. The caller must use a
 * short server-side statement timeout: exact counts may scan large queues. */
export async function readTelemetryHealth(pool: pg.Pool) {
  const { rows } = await pool.query<{ dirty_hours: string; oldest_dirty_seconds: number; default_rows: string }>(`
    SELECT count(*)::text AS dirty_hours,
      coalesce(greatest(0,extract(epoch FROM statement_timestamp()-min(created_at))),0)::double precision AS oldest_dirty_seconds,
      (SELECT count(*)::text FROM telemetry.readings_default) AS default_rows
    FROM telemetry.dirty_hours
  `);
  const row = rows[0]!;
  return {
    dirty_hours: Number(row.dirty_hours),
    oldest_dirty_seconds: row.oldest_dirty_seconds,
    default_rows: Number(row.default_rows),
  };
}
