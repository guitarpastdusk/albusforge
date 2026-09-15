CREATE TABLE "telemetry"."capability_presence" (
	"device_id" uuid NOT NULL,
	"capability_id" text NOT NULL,
	"last_capture_at" timestamp with time zone NOT NULL,
	"last_received_at" timestamp with time zone NOT NULL,
	CONSTRAINT "capability_presence_device_id_capability_id_pk" PRIMARY KEY("device_id","capability_id")
);
--> statement-breakpoint
CREATE TABLE "telemetry"."device_capabilities" (
	"device_id" uuid NOT NULL,
	"capability_id" text NOT NULL,
	"kind" text NOT NULL,
	"payload_schema" text NOT NULL,
	"profile_id" text NOT NULL,
	"profile_version" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"interval_s" integer NOT NULL,
	"max_bytes" integer,
	"max_width" integer,
	"max_height" integer,
	"channels" jsonb,
	CONSTRAINT "device_capabilities_device_id_capability_id_pk" PRIMARY KEY("device_id","capability_id"),
	CONSTRAINT "device_capabilities_identity_check" CHECK ("telemetry"."device_capabilities"."capability_id" ~ '^[a-z][a-z0-9_.-]{0,63}$' AND length("telemetry"."device_capabilities"."profile_id") BETWEEN 1 AND 128 AND "telemetry"."device_capabilities"."profile_version">0),
	CONSTRAINT "device_capabilities_interval_check" CHECK ("telemetry"."device_capabilities"."interval_s" BETWEEN 1 AND 86400),
	CONSTRAINT "device_capabilities_kind_check" CHECK (("telemetry"."device_capabilities"."kind"='image' AND "telemetry"."device_capabilities"."payload_schema"='jpeg.v1' AND "telemetry"."device_capabilities"."max_bytes" IS NOT NULL AND "telemetry"."device_capabilities"."max_bytes" BETWEEN 1 AND 1048576 AND "telemetry"."device_capabilities"."max_width" IS NOT NULL AND "telemetry"."device_capabilities"."max_width" BETWEEN 1 AND 4096 AND "telemetry"."device_capabilities"."max_height" IS NOT NULL AND "telemetry"."device_capabilities"."max_height" BETWEEN 1 AND 4096 AND "telemetry"."device_capabilities"."channels" IS NULL) OR ("telemetry"."device_capabilities"."kind"='measurement' AND "telemetry"."device_capabilities"."payload_schema"='readings.v1' AND "telemetry"."device_capabilities"."channels" IS NOT NULL AND jsonb_typeof("telemetry"."device_capabilities"."channels")='object' AND "telemetry"."device_capabilities"."channels"<>'{}'::jsonb AND "telemetry"."device_capabilities"."max_bytes" IS NULL AND "telemetry"."device_capabilities"."max_width" IS NULL AND "telemetry"."device_capabilities"."max_height" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "telemetry"."observation_attempts" (
	"device_id" uuid PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"attempts" integer NOT NULL,
	CONSTRAINT "observation_attempts_nonnegative_check" CHECK ("telemetry"."observation_attempts"."attempts">=0)
);
--> statement-breakpoint
CREATE TABLE "telemetry"."observation_deletion_intents" (
	"object_key" text PRIMARY KEY NOT NULL,
	"generation" text,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "observation_deletion_intents_generation_check" CHECK ("telemetry"."observation_deletion_intents"."generation" IS NULL OR "telemetry"."observation_deletion_intents"."generation" ~ '^[1-9][0-9]*$'),
	CONSTRAINT "observation_deletion_intents_attempts_check" CHECK ("telemetry"."observation_deletion_intents"."attempts">=0)
);
--> statement-breakpoint
CREATE TABLE "telemetry"."observation_images" (
	"device_id" uuid NOT NULL,
	"observation_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"generation" text,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	CONSTRAINT "observation_images_device_id_observation_id_pk" PRIMARY KEY("device_id","observation_id"),
	CONSTRAINT "observation_images_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "observation_images_generation_check" CHECK ("telemetry"."observation_images"."generation" IS NULL OR "telemetry"."observation_images"."generation" ~ '^[1-9][0-9]*$'),
	CONSTRAINT "observation_images_dimensions_check" CHECK ("telemetry"."observation_images"."width" BETWEEN 1 AND 4096 AND "telemetry"."observation_images"."height" BETWEEN 1 AND 4096)
);
--> statement-breakpoint
CREATE TABLE "telemetry"."observation_receipts" (
	"device_id" uuid NOT NULL,
	"observation_id" uuid NOT NULL,
	"capability_id" text NOT NULL,
	"kind" text DEFAULT 'image' NOT NULL,
	"payload_schema" text DEFAULT 'jpeg.v1' NOT NULL,
	"fingerprint" text NOT NULL,
	"sha256" text NOT NULL,
	"bytes" integer NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"state" text NOT NULL,
	"lease_id" uuid,
	"lease_until" timestamp with time zone,
	"reserved_day" text NOT NULL,
	CONSTRAINT "observation_receipts_device_id_observation_id_pk" PRIMARY KEY("device_id","observation_id"),
	CONSTRAINT "observation_receipts_digest_check" CHECK ("telemetry"."observation_receipts"."fingerprint" ~ '^[a-f0-9]{64}$' AND "telemetry"."observation_receipts"."sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "observation_receipts_bytes_check" CHECK ("telemetry"."observation_receipts"."bytes" BETWEEN 1 AND 1048576),
	CONSTRAINT "observation_receipts_kind_check" CHECK ("telemetry"."observation_receipts"."kind"='image' AND "telemetry"."observation_receipts"."payload_schema"='jpeg.v1'),
	CONSTRAINT "observation_receipts_state_check" CHECK (("telemetry"."observation_receipts"."state"='reserved' AND "telemetry"."observation_receipts"."received_at" IS NULL AND "telemetry"."observation_receipts"."lease_id" IS NOT NULL AND "telemetry"."observation_receipts"."lease_until" IS NOT NULL) OR ("telemetry"."observation_receipts"."state"='stored' AND "telemetry"."observation_receipts"."received_at" IS NOT NULL AND "telemetry"."observation_receipts"."lease_id" IS NULL AND "telemetry"."observation_receipts"."lease_until" IS NULL) OR ("telemetry"."observation_receipts"."state"='expired' AND "telemetry"."observation_receipts"."lease_id" IS NULL AND "telemetry"."observation_receipts"."lease_until" IS NULL)),
	CONSTRAINT "observation_receipts_lease_check" CHECK (("telemetry"."observation_receipts"."lease_id" IS NULL) = ("telemetry"."observation_receipts"."lease_until" IS NULL)),
	CONSTRAINT "observation_receipts_day_check" CHECK ("telemetry"."observation_receipts"."reserved_day" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
);
--> statement-breakpoint
CREATE TABLE "telemetry"."observation_usage" (
	"device_id" uuid NOT NULL,
	"day" text NOT NULL,
	"accepted_count" bigint DEFAULT 0 NOT NULL,
	"accepted_bytes" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "observation_usage_device_id_day_pk" PRIMARY KEY("device_id","day"),
	CONSTRAINT "observation_usage_nonnegative_check" CHECK ("telemetry"."observation_usage"."accepted_count">=0 AND "telemetry"."observation_usage"."accepted_bytes">=0)
);
--> statement-breakpoint
ALTER TABLE "telemetry"."capability_presence" ADD CONSTRAINT "capability_presence_device_id_capability_id_device_capabilities_device_id_capability_id_fk" FOREIGN KEY ("device_id","capability_id") REFERENCES "telemetry"."device_capabilities"("device_id","capability_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry"."device_capabilities" ADD CONSTRAINT "device_capabilities_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "telemetry"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry"."observation_attempts" ADD CONSTRAINT "observation_attempts_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "telemetry"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry"."observation_images" ADD CONSTRAINT "observation_images_device_id_observation_id_observation_receipts_device_id_observation_id_fk" FOREIGN KEY ("device_id","observation_id") REFERENCES "telemetry"."observation_receipts"("device_id","observation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry"."observation_receipts" ADD CONSTRAINT "observation_receipts_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "telemetry"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry"."observation_usage" ADD CONSTRAINT "observation_usage_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "telemetry"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "observation_deletion_intents_queue_idx" ON "telemetry"."observation_deletion_intents" USING btree ("queued_at");--> statement-breakpoint
CREATE INDEX "observation_receipts_history_idx" ON "telemetry"."observation_receipts" USING btree ("device_id","capability_id","captured_at","observation_id");--> statement-breakpoint
CREATE INDEX "observation_receipts_expiry_idx" ON "telemetry"."observation_receipts" USING btree ("state","expires_at");--> statement-breakpoint
CREATE INDEX "observation_receipts_lease_idx" ON "telemetry"."observation_receipts" USING btree ("state","lease_until");--> statement-breakpoint
CREATE INDEX "observation_receipts_reservations_idx" ON "telemetry"."observation_receipts" USING btree ("device_id","reserved_day","state");
--> statement-breakpoint
-- Keep deletion work outside device/tenant cascades. Also queue reservations
-- without a known generation: the worker resolves the immutable object first.
CREATE FUNCTION telemetry.queue_observation_image_deletion() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, telemetry AS $$
BEGIN
  INSERT INTO telemetry.observation_deletion_intents (object_key, generation)
  VALUES (OLD.object_key, OLD.generation)
  ON CONFLICT (object_key) DO UPDATE
    SET generation = COALESCE(EXCLUDED.generation, observation_deletion_intents.generation);
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER observation_image_deletion BEFORE DELETE ON telemetry.observation_images
FOR EACH ROW EXECUTE FUNCTION telemetry.queue_observation_image_deletion();
