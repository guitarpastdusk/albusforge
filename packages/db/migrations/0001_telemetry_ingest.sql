CREATE SCHEMA "telemetry";
--> statement-breakpoint
CREATE TABLE "telemetry"."devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"channels" jsonb NOT NULL,
	"source" jsonb NOT NULL,
	"next_s" integer DEFAULT 300 NOT NULL,
	"last_seen_at" timestamp with time zone,
	"last_seq" bigint,
	"status" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "telemetry"."latest" (
	"device_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"seq" bigint NOT NULL,
	"ordinal" integer NOT NULL,
	"value" double precision NOT NULL,
	CONSTRAINT "latest_device_id_channel_pk" PRIMARY KEY("device_id","channel")
);
--> statement-breakpoint
CREATE TABLE "telemetry"."packets" (
	"device_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"fingerprint" text NOT NULL,
	"response" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "packets_device_id_seq_pk" PRIMARY KEY("device_id","seq")
);
--> statement-breakpoint
CREATE TABLE "telemetry"."readings" (
	"device_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"ordinal" integer NOT NULL,
	"channel" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"value" double precision NOT NULL,
	CONSTRAINT "readings_device_id_seq_ordinal_pk" PRIMARY KEY("device_id","seq","ordinal")
);
--> statement-breakpoint
CREATE TABLE "telemetry"."usage" (
	"device_id" uuid NOT NULL,
	"period" text NOT NULL,
	"readings_in" bigint NOT NULL,
	"payload_bytes" bigint NOT NULL,
	CONSTRAINT "usage_device_id_period_pk" PRIMARY KEY("device_id","period")
);
--> statement-breakpoint
ALTER TABLE "telemetry"."devices" ADD CONSTRAINT "devices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "users"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry"."latest" ADD CONSTRAINT "latest_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "telemetry"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry"."packets" ADD CONSTRAINT "packets_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "telemetry"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry"."readings" ADD CONSTRAINT "readings_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "telemetry"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry"."usage" ADD CONSTRAINT "usage_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "telemetry"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "devices_tenant_idx" ON "telemetry"."devices" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "readings_series_idx" ON "telemetry"."readings" USING btree ("device_id","channel","ts");