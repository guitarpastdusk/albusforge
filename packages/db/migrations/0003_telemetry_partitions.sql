-- Native partitioning and transition-table triggers are custom Drizzle migration DDL.
-- Preserve existing rows by attaching the original table as the default partition.
ALTER TABLE telemetry.readings RENAME TO readings_default;
ALTER TABLE telemetry.readings_default RENAME CONSTRAINT readings_device_id_seq_ordinal_ts_pk TO readings_default_pk;
ALTER INDEX telemetry.readings_series_idx RENAME TO readings_default_series_idx;
CREATE TABLE telemetry.readings (
  LIKE telemetry.readings_default INCLUDING DEFAULTS INCLUDING CONSTRAINTS,
  CONSTRAINT readings_device_id_seq_ordinal_ts_pk PRIMARY KEY(device_id,seq,ordinal,ts),
  CONSTRAINT readings_device_id_devices_id_fk FOREIGN KEY(device_id) REFERENCES telemetry.devices(id) ON DELETE CASCADE
) PARTITION BY RANGE(ts);
ALTER TABLE telemetry.readings ATTACH PARTITION telemetry.readings_default DEFAULT;
CREATE INDEX readings_series_idx ON telemetry.readings(device_id,channel,ts);
INSERT INTO telemetry.retention_state(id,raw_before) VALUES(1,'1970-01-01 00:00:00+00');
--> statement-breakpoint
CREATE FUNCTION telemetry.mark_dirty_hours() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM batch WHERE ts < (SELECT raw_before FROM telemetry.retention_state WHERE id=1)) THEN
    RAISE EXCEPTION 'Reading predates retained raw data' USING ERRCODE='23514', CONSTRAINT='telemetry_retention_bound';
  END IF;
  INSERT INTO telemetry.dirty_hours(device_id,channel,bucket)
    SELECT DISTINCT device_id,channel,date_trunc('hour',ts,'UTC') FROM batch
    ORDER BY device_id,channel,date_trunc('hour',ts,'UTC')
    ON CONFLICT(device_id,channel,bucket) DO UPDATE SET touched_at=clock_timestamp();
  RETURN NULL;
END $$;
CREATE TRIGGER readings_mark_dirty AFTER INSERT ON telemetry.readings
REFERENCING NEW TABLE AS batch FOR EACH STATEMENT EXECUTE FUNCTION telemetry.mark_dirty_hours();
INSERT INTO telemetry.dirty_hours(device_id,channel,bucket)
  SELECT DISTINCT device_id,channel,date_trunc('hour',ts,'UTC') FROM telemetry.readings;
--> statement-breakpoint
CREATE FUNCTION telemetry.ensure_reading_partition(day date) RETURNS boolean LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  partition_name text := 'readings_d' || to_char(day,'YYYYMMDD');
  lower_bound timestamptz := day::timestamp AT TIME ZONE 'UTC';
  upper_bound timestamptz := (day+1)::timestamp AT TIME ZONE 'UTC';
BEGIN
  PERFORM pg_advisory_xact_lock(7243004119431865602);
  IF EXISTS(SELECT 1 FROM pg_inherits WHERE inhparent='telemetry.readings'::regclass AND inhrelid=to_regclass('telemetry.'||partition_name)) THEN
    RETURN false;
  END IF;
  LOCK TABLE telemetry.readings IN ACCESS EXCLUSIVE MODE;
  -- A default partition preserves acceptance during scheduler outages. Drain it
  -- before ATTACH so existing rows cannot overlap the new partition's bounds.
  EXECUTE format('CREATE TABLE telemetry.%I (LIKE telemetry.readings INCLUDING DEFAULTS INCLUDING CONSTRAINTS)', partition_name);
  EXECUTE format('ALTER TABLE telemetry.%I ADD CHECK (ts >= %L::timestamptz AND ts < %L::timestamptz)', partition_name, lower_bound, upper_bound);
  EXECUTE format('WITH moved AS (DELETE FROM telemetry.readings_default WHERE ts >= $1 AND ts < $2 RETURNING *) INSERT INTO telemetry.%I SELECT * FROM moved', partition_name)
    USING lower_bound,upper_bound;
  EXECUTE format('ALTER TABLE telemetry.readings ATTACH PARTITION telemetry.%I FOR VALUES FROM (%L) TO (%L)', partition_name, lower_bound, upper_bound);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION telemetry.ensure_reading_partition(date) FROM PUBLIC;
--> statement-breakpoint
DO $$
DECLARE day date;
BEGIN
  FOR day IN SELECT ((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date + i) FROM generate_series(0,7) i LOOP
    PERFORM telemetry.ensure_reading_partition(day);
  END LOOP;
END $$;
