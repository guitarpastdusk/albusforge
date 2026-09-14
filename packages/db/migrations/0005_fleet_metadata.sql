ALTER TABLE "telemetry"."devices" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "telemetry"."devices" ADD COLUMN "metadata_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "devices_tenant_cursor_idx" ON "telemetry"."devices" USING btree ("tenant_id","id");