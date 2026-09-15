CREATE TABLE "telemetry"."device_chat_requests" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
	"outcome" text DEFAULT 'reserved' NOT NULL,
	"model" text,
	"model_attempted" boolean DEFAULT false NOT NULL,
	"model_calls" smallint DEFAULT 0 NOT NULL,
	"tool_calls" smallint DEFAULT 0 NOT NULL,
	"usage_known" boolean DEFAULT false NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cache_read_tokens" integer,
	"cache_creation_tokens" integer,
	"cost_usd" numeric(16, 6),
	CONSTRAINT "device_chat_outcome" CHECK ("telemetry"."device_chat_requests"."outcome" IN ('reserved','model','no_tool','unavailable','failed')),
	CONSTRAINT "device_chat_input" CHECK ("telemetry"."device_chat_requests"."input_tokens" >= 0),
	CONSTRAINT "device_chat_output" CHECK ("telemetry"."device_chat_requests"."output_tokens" >= 0),
	CONSTRAINT "device_chat_cache_read" CHECK ("telemetry"."device_chat_requests"."cache_read_tokens" >= 0),
	CONSTRAINT "device_chat_cache_creation" CHECK ("telemetry"."device_chat_requests"."cache_creation_tokens" >= 0),
	CONSTRAINT "device_chat_cost" CHECK ("telemetry"."device_chat_requests"."cost_usd" >= 0),
	CONSTRAINT "device_chat_model_calls" CHECK ("telemetry"."device_chat_requests"."model_calls" >= 0),
	CONSTRAINT "device_chat_tool_calls" CHECK ("telemetry"."device_chat_requests"."tool_calls" >= 0)
);
--> statement-breakpoint
ALTER TABLE "telemetry"."device_chat_requests" ADD CONSTRAINT "device_chat_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "users"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry"."device_chat_requests" ADD CONSTRAINT "device_chat_requests_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "users"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry"."device_chat_requests" ADD CONSTRAINT "device_chat_requests_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "telemetry"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_chat_tenant_window" ON "telemetry"."device_chat_requests" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "device_chat_actor_window" ON "telemetry"."device_chat_requests" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "device_chat_global_window" ON "telemetry"."device_chat_requests" USING btree ("created_at");