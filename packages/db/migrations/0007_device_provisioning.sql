
ALTER TABLE "builds"."builds" ADD CONSTRAINT "builds_id_tenant_unique" UNIQUE("id","tenant_id");--> statement-breakpoint
ALTER TABLE "builds"."code_bundles" ADD CONSTRAINT "code_bundles_build_plan_version_unique" UNIQUE("build_id","plan_version","version");--> statement-breakpoint
ALTER TABLE "telemetry"."devices" ADD CONSTRAINT "devices_id_tenant_unique" UNIQUE("id","tenant_id");--> statement-breakpointCREATE TABLE "telemetry"."device_provisionings" (
	"device_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"build_id" uuid NOT NULL,
	"plan_version" integer NOT NULL,
	"code_version" integer NOT NULL,
	"claim_request_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"manifest_digest" text NOT NULL,
	"ingest_url" text NOT NULL,
	"credential_version" integer DEFAULT 1 NOT NULL,
	"seq_start" bigint DEFAULT 0 NOT NULL,
	"handoff_user_id" uuid,
	"handoff_session_root" uuid,
	"handoff_expires_at" timestamp with time zone NOT NULL,
	"handoff_consumed_at" timestamp with time zone,
	"handoff_key_id" text,
	"handoff_nonce" text,
	"handoff_ciphertext" text,
	"handoff_tag" text,
	"reissue_request_id" uuid,
	"reissue_from_version" integer,
	CONSTRAINT "device_provisionings_one_per_plan" UNIQUE("build_id","plan_version"),
	CONSTRAINT "device_provisionings_claim_request" UNIQUE("tenant_id","claim_request_id"),
	CONSTRAINT "device_provisionings_version_check" CHECK ("telemetry"."device_provisionings"."plan_version">0 AND "telemetry"."device_provisionings"."code_version">0 AND "telemetry"."device_provisionings"."credential_version">0),
	CONSTRAINT "device_provisionings_sequence_check" CHECK ("telemetry"."device_provisionings"."seq_start">=0 AND "telemetry"."device_provisionings"."seq_start"<=9007199254740991),
	CONSTRAINT "device_provisionings_sealed_check" CHECK (("telemetry"."device_provisionings"."handoff_key_id" IS NULL AND "telemetry"."device_provisionings"."handoff_nonce" IS NULL AND "telemetry"."device_provisionings"."handoff_ciphertext" IS NULL AND "telemetry"."device_provisionings"."handoff_tag" IS NULL) OR ("telemetry"."device_provisionings"."handoff_key_id" IS NOT NULL AND "telemetry"."device_provisionings"."handoff_nonce" IS NOT NULL AND "telemetry"."device_provisionings"."handoff_ciphertext" IS NOT NULL AND "telemetry"."device_provisionings"."handoff_tag" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "telemetry"."device_provisionings" ADD CONSTRAINT "device_provisionings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry"."device_provisionings" ADD CONSTRAINT "device_provisionings_handoff_user_id_users_id_fk" FOREIGN KEY ("handoff_user_id") REFERENCES "users"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry"."device_provisionings" ADD CONSTRAINT "device_provisionings_handoff_session_root_sessions_id_fk" FOREIGN KEY ("handoff_session_root") REFERENCES "users"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry"."device_provisionings" ADD CONSTRAINT "device_provisionings_device_tenant_fk" FOREIGN KEY ("device_id","tenant_id") REFERENCES "telemetry"."devices"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry"."device_provisionings" ADD CONSTRAINT "device_provisionings_build_tenant_fk" FOREIGN KEY ("build_id","tenant_id") REFERENCES "builds"."builds"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry"."device_provisionings" ADD CONSTRAINT "device_provisionings_plan_fk" FOREIGN KEY ("build_id","plan_version") REFERENCES "builds"."plans"("build_id","version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry"."device_provisionings" ADD CONSTRAINT "device_provisionings_code_plan_fk" FOREIGN KEY ("build_id","plan_version","code_version") REFERENCES "builds"."code_bundles"("build_id","plan_version","version") ON DELETE restrict ON UPDATE no action;