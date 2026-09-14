ALTER TABLE "telemetry"."device_capabilities" ADD COLUMN "monitoring_started_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "telemetry"."observation_maintenance_state" ADD COLUMN "health_device_cursor" uuid;--> statement-breakpoint
ALTER TABLE "telemetry"."observation_maintenance_state" ADD COLUMN "health_capability_cursor" text;--> statement-breakpoint
ALTER TABLE "telemetry"."observation_maintenance_state" ADD COLUMN "health_scan_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "telemetry"."observation_maintenance_state" ADD COLUMN "health_enabled_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "telemetry"."observation_maintenance_state" ADD COLUMN "health_stale_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE FUNCTION telemetry.reset_observation_monitoring_start() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, telemetry AS $$
BEGIN
  IF (NOT OLD.enabled AND NEW.enabled) OR OLD.kind IS DISTINCT FROM NEW.kind OR OLD.interval_s IS DISTINCT FROM NEW.interval_s THEN
    NEW.monitoring_started_at := now();
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER observation_monitoring_start BEFORE UPDATE ON telemetry.device_capabilities
FOR EACH ROW EXECUTE FUNCTION telemetry.reset_observation_monitoring_start();
