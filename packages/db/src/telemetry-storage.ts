import pg from "pg";

/** Recompute complete dirty hours; retry-safe and shared across worker instances. */
export async function processTelemetryRollups(pool: pg.Pool, limit = 64): Promise<number> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1024) throw new Error("Invalid rollup batch limit");
  let processed = 0;
  for (; processed < limit; processed++) {
    const client = await pool.connect();
    let discard = false;
    try {
      await client.query("BEGIN");
      const item = (await client.query<{ device_id: string; channel: string; bucket: Date }>(
        "SELECT device_id,channel,bucket FROM telemetry.dirty_hours ORDER BY created_at,bucket,device_id,channel FOR UPDATE SKIP LOCKED LIMIT 1",
      )).rows[0];
      if (!item) { await client.query("COMMIT"); break; }
      const args = [item.device_id, item.channel, item.bucket];
      // Full replacement, never incrementing previous aggregates: retries and late
      // samples yield the same answer as querying retained raw data from scratch.
      await client.query(`DELETE FROM telemetry.rollups WHERE device_id=$1 AND channel=$2 AND bucket >= $3 AND bucket < $3::timestamptz+interval '1 hour'`, args);
      for (const [resolution, unit] of [["1m", "minute"], ["1h", "hour"]]) {
        await client.query(`WITH samples AS MATERIALIZED (
          SELECT *,date_trunc($4,ts,'UTC') AS bucket FROM telemetry.readings
          WHERE device_id=$1 AND channel=$2 AND ts >= $3 AND ts < $3::timestamptz+interval '1 hour'
        ), summary AS (
          SELECT bucket,count(*) AS n,sum(value::numeric) AS sum,min(value) AS min,max(value) AS max,
            stddev_pop(value::numeric) AS stddev FROM samples GROUP BY bucket
        ), latest AS (
          SELECT DISTINCT ON(bucket) bucket,value FROM samples ORDER BY bucket,ts DESC,seq DESC,ordinal DESC
        ) INSERT INTO telemetry.rollups(device_id,channel,resolution,bucket,n,sum,min,max,last,stddev)
          SELECT $1,$2,$5,s.bucket,s.n,s.sum,s.min,s.max,l.value,s.stddev FROM summary s JOIN latest l USING(bucket)
          WHERE $5='1h' OR s.bucket >= date_trunc('day',CURRENT_TIMESTAMP,'UTC')-interval '7 days'`, [...args, unit, resolution]);
      }
      // An ingest transaction competing for this marker waits. Once we commit,
      // its trigger creates/updates a marker again; uncommitted data cannot be lost.
      await client.query("DELETE FROM telemetry.dirty_hours WHERE device_id=$1 AND channel=$2 AND bucket=$3", args);
      await client.query("COMMIT");
    } catch (error) {
      discard = true;
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally { client.release(discard); }
  }
  return processed;
}

/** Owner-only partition DDL and retention; never run with the HTTP service's role. */
export async function maintainTelemetryStorage(pool: pg.Pool) {
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout='2s'");
    await client.query("SELECT pg_advisory_xact_lock(7243004119431865602)");
    const dates = (await client.query<{ day: string }>(`SELECT day::text FROM (
      SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date+i AS day FROM generate_series(0,7) i
      UNION SELECT DISTINCT (ts AT TIME ZONE 'UTC')::date FROM telemetry.readings_default
      WHERE ts >= date_trunc('day',CURRENT_TIMESTAMP,'UTC')-interval '90 days'
    ) days ORDER BY day`)).rows;
    let created = 0;
    for (const { day } of dates) {
      if ((await client.query("SELECT telemetry.ensure_reading_partition($1::date) AS created", [day])).rows[0].created) created++;
    }
    // Blocks inserts while advancing the retention boundary. Their trigger rejects
    // older samples afterwards, so expired raw data cannot later overwrite a full
    // retained hourly aggregate with an incomplete reconstruction.
    await client.query("LOCK TABLE telemetry.readings IN ACCESS EXCLUSIVE MODE");
    await client.query(`UPDATE telemetry.retention_state SET raw_before=GREATEST(raw_before,date_trunc('day',CURRENT_TIMESTAMP,'UTC')-interval '90 days') WHERE id=1`);
    const partitions = (await client.query<{ relname: string; day: string }>(`SELECT c.relname,
      to_date(substring(c.relname from 11),'YYYYMMDD')::text AS day
      FROM pg_inherits i JOIN pg_class c ON c.oid=i.inhrelid
      WHERE i.inhparent='telemetry.readings'::regclass AND c.relname ~ '^readings_d[0-9]{8}$'
      AND to_date(substring(c.relname from 11),'YYYYMMDD')+1 <= (SELECT raw_before AT TIME ZONE 'UTC' FROM telemetry.retention_state WHERE id=1)`)).rows;
    let dropped = 0, deferred = 0;
    for (const partition of partitions) {
      const pending = await client.query(`SELECT 1 FROM telemetry.dirty_hours WHERE bucket >= $1::date::timestamp AT TIME ZONE 'UTC' AND bucket < ($1::date+1)::timestamp AT TIME ZONE 'UTC' LIMIT 1`, [partition.day]);
      if (pending.rowCount) { deferred++; continue; }
      await client.query(`DROP TABLE telemetry.${pg.escapeIdentifier(partition.relname)}`);
      dropped++;
    }
    const removed = await client.query(`DELETE FROM telemetry.readings_default r
      WHERE ts < (SELECT raw_before FROM telemetry.retention_state WHERE id=1)
      AND NOT EXISTS(SELECT 1 FROM telemetry.dirty_hours d WHERE d.device_id=r.device_id AND d.channel=r.channel AND d.bucket=date_trunc('hour',r.ts,'UTC'))`);
    await client.query(`DELETE FROM telemetry.rollups WHERE resolution='1m' AND bucket < date_trunc('day',CURRENT_TIMESTAMP,'UTC')-interval '7 days'`);
    await client.query("COMMIT");
    return { created, dropped, deferred, defaultRowsRemoved: removed.rowCount };
  } catch (error) {
    discard = true; await client.query("ROLLBACK").catch(() => {}); throw error;
  } finally { client.release(discard); }
}
