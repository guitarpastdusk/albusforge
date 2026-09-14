ALTER TABLE "builds"."plans" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "builds"."plans" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "builds"."plans" ADD COLUMN "accepted_by" uuid;--> statement-breakpoint
ALTER TABLE "builds"."plans" ADD CONSTRAINT "plans_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "users"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plans_one_accepted_spec_idx" ON "builds"."plans" USING btree ("build_id","spec_version") WHERE "builds"."plans"."accepted_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "builds"."plans" ADD CONSTRAINT "plans_acceptance_metadata_check" CHECK ("builds"."plans"."accepted_at" IS NULL OR "builds"."plans"."metadata" IS NOT NULL);