CREATE TABLE "telemetry"."sensor_ask_requests" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
	"outcome" text DEFAULT 'reserved' NOT NULL,
	"model" text,
	"model_attempted" boolean DEFAULT false NOT NULL,
	"usage_known" boolean DEFAULT false NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cache_read_tokens" integer,
	"cache_creation_tokens" integer,
	"cost_usd" numeric(16, 6),
	CONSTRAINT "sensor_ask_outcome" CHECK ("telemetry"."sensor_ask_requests"."outcome" IN ('reserved','model','evidence_only','failed')),
	CONSTRAINT "sensor_ask_input" CHECK ("telemetry"."sensor_ask_requests"."input_tokens" >= 0),
	CONSTRAINT "sensor_ask_output" CHECK ("telemetry"."sensor_ask_requests"."output_tokens" >= 0),
	CONSTRAINT "sensor_ask_cache_read" CHECK ("telemetry"."sensor_ask_requests"."cache_read_tokens" >= 0),
	CONSTRAINT "sensor_ask_cache_creation" CHECK ("telemetry"."sensor_ask_requests"."cache_creation_tokens" >= 0),
	CONSTRAINT "sensor_ask_cost" CHECK ("telemetry"."sensor_ask_requests"."cost_usd" >= 0)
);
--> statement-breakpoint
ALTER TABLE "telemetry"."sensor_ask_requests" ADD CONSTRAINT "sensor_ask_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "users"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry"."sensor_ask_requests" ADD CONSTRAINT "sensor_ask_requests_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "users"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry"."sensor_ask_requests" ADD CONSTRAINT "sensor_ask_requests_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "telemetry"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sensor_ask_tenant_window" ON "telemetry"."sensor_ask_requests" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "sensor_ask_global_window" ON "telemetry"."sensor_ask_requests" USING btree ("created_at");