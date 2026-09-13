CREATE TABLE "telemetry"."dirty_hours" (
	"device_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"bucket" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"touched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dirty_hours_device_id_channel_bucket_pk" PRIMARY KEY("device_id","channel","bucket")
);
--> statement-breakpoint
CREATE TABLE "telemetry"."retention_state" (
	"id" integer PRIMARY KEY NOT NULL,
	"raw_before" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telemetry"."rollups" (
	"device_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"resolution" text NOT NULL,
	"bucket" timestamp with time zone NOT NULL,
	"n" bigint NOT NULL,
	"sum" numeric NOT NULL,
	"min" double precision NOT NULL,
	"max" double precision NOT NULL,
	"last" double precision NOT NULL,
	"stddev" numeric NOT NULL,
	CONSTRAINT "rollups_device_id_channel_resolution_bucket_pk" PRIMARY KEY("device_id","channel","resolution","bucket")
);
--> statement-breakpoint
ALTER TABLE "telemetry"."readings" DROP CONSTRAINT "readings_device_id_seq_ordinal_pk";--> statement-breakpoint
ALTER TABLE "telemetry"."readings" ADD CONSTRAINT "readings_device_id_seq_ordinal_ts_pk" PRIMARY KEY("device_id","seq","ordinal","ts");--> statement-breakpoint
ALTER TABLE "telemetry"."dirty_hours" ADD CONSTRAINT "dirty_hours_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "telemetry"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry"."rollups" ADD CONSTRAINT "rollups_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "telemetry"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dirty_hours_bucket_idx" ON "telemetry"."dirty_hours" USING btree ("bucket");--> statement-breakpoint
CREATE INDEX "rollups_retention_idx" ON "telemetry"."rollups" USING btree ("resolution","bucket");