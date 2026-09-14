CREATE TABLE "telemetry"."observation_maintenance_state" (
	"id" integer PRIMARY KEY NOT NULL,
	"orphan_page_token" text,
	CONSTRAINT "observation_maintenance_singleton_check" CHECK ("telemetry"."observation_maintenance_state"."id"=1)
);
--> statement-breakpoint
ALTER TABLE "telemetry"."observation_receipts" DROP CONSTRAINT "observation_receipts_state_check";--> statement-breakpoint
ALTER TABLE "telemetry"."observation_receipts" ADD COLUMN "reservation_credential_hash" text;--> statement-breakpoint
ALTER TABLE "telemetry"."observation_receipts" ADD COLUMN "maintenance_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "telemetry"."observation_receipts" ADD CONSTRAINT "observation_receipts_credential_check" CHECK ("telemetry"."observation_receipts"."reservation_credential_hash" IS NULL OR "telemetry"."observation_receipts"."reservation_credential_hash" ~ '^[a-f0-9]{64}$');--> statement-breakpoint
ALTER TABLE "telemetry"."observation_receipts" ADD CONSTRAINT "observation_receipts_state_check" CHECK (("telemetry"."observation_receipts"."state"='reserved' AND "telemetry"."observation_receipts"."received_at" IS NULL AND "telemetry"."observation_receipts"."lease_id" IS NOT NULL AND "telemetry"."observation_receipts"."lease_until" IS NOT NULL) OR ("telemetry"."observation_receipts"."state"='stored' AND "telemetry"."observation_receipts"."received_at" IS NOT NULL AND "telemetry"."observation_receipts"."lease_id" IS NULL AND "telemetry"."observation_receipts"."lease_until" IS NULL) OR ("telemetry"."observation_receipts"."state"='expired' AND "telemetry"."observation_receipts"."lease_id" IS NULL AND "telemetry"."observation_receipts"."lease_until" IS NULL) OR ("telemetry"."observation_receipts"."state"='failed' AND "telemetry"."observation_receipts"."received_at" IS NULL AND "telemetry"."observation_receipts"."lease_id" IS NULL AND "telemetry"."observation_receipts"."lease_until" IS NULL));