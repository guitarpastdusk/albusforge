CREATE SCHEMA "users";
--> statement-breakpoint
CREATE SCHEMA "registry";
--> statement-breakpoint
CREATE SCHEMA "builds";
--> statement-breakpoint
CREATE TABLE "users"."email_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users"."sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"active_tenant_id" uuid NOT NULL,
	"parent_session_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_key" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users"."tenant_members" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_members_tenant_id_user_id_pk" PRIMARY KEY("tenant_id","user_id"),
	CONSTRAINT "tenant_members_role_check" CHECK ("role" IN ('admin', 'operator', 'viewer'))
);
--> statement-breakpoint
CREATE TABLE "users"."tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_key" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "users"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registry"."compat_matrix" (
	"driver_pkg" text NOT NULL,
	"driver_ver" text NOT NULL,
	"runtime_ver" text NOT NULL,
	"brain_id" text NOT NULL,
	"status" text NOT NULL,
	CONSTRAINT "compat_matrix_driver_pkg_driver_ver_runtime_ver_brain_id_pk" PRIMARY KEY("driver_pkg","driver_ver","runtime_ver","brain_id")
);
--> statement-breakpoint
CREATE TABLE "registry"."parts" (
	"id" text NOT NULL,
	"version" text NOT NULL,
	"status" text NOT NULL,
	"definition" jsonb NOT NULL,
	"loaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parts_id_version_pk" PRIMARY KEY("id","version"),
	CONSTRAINT "parts_status_check" CHECK ("status" IN ('draft', 'active', 'deprecated', 'retired'))
);
--> statement-breakpoint
CREATE TABLE "builds"."bodies" (
	"build_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"plan_version" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"step_ref" text,
	"stl_refs" jsonb,
	"lint_report" jsonb,
	"serial" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bodies_build_id_version_pk" PRIMARY KEY("build_id","version"),
	CONSTRAINT "bodies_status_check" CHECK ("status" IN ('pending', 'running', 'passed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "builds"."build_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"build_id" uuid NOT NULL,
	"role" text NOT NULL,
	"text" text NOT NULL,
	"client_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "build_messages_client_message_id_key" UNIQUE("build_id","client_message_id"),
	CONSTRAINT "build_messages_role_check" CHECK ("role" IN ('user', 'assistant'))
);
--> statement-breakpoint
CREATE TABLE "builds"."builds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"anon_owner_hash" text,
	"created_by_user_id" uuid,
	"status" text DEFAULT 'asking' NOT NULL,
	"ask_text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "builds_owner_check" CHECK ("tenant_id" IS NOT NULL OR "anon_owner_hash" IS NOT NULL),
	CONSTRAINT "builds_status_check" CHECK ("status" IN ('asking', 'specifying', 'planning', 'coding', 'bodying', 'ready', 'ordered'))
);
--> statement-breakpoint
CREATE TABLE "builds"."code_bundles" (
	"build_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"plan_version" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"storage_ref" text,
	"compile_log" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "code_bundles_build_id_version_pk" PRIMARY KEY("build_id","version"),
	CONSTRAINT "code_bundles_status_check" CHECK ("status" IN ('pending', 'running', 'passed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "builds"."llm_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"build_id" uuid,
	"tenant_id" uuid,
	"anon_owner_hash" text,
	"stage" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_input_tokens" integer DEFAULT 0 NOT NULL,
	"cache_creation_input_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) NOT NULL,
	"stop_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "builds"."plans" (
	"build_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"spec_version" integer NOT NULL,
	"part_versions" jsonb NOT NULL,
	"wiring_graph" jsonb NOT NULL,
	"power_budget" jsonb NOT NULL,
	"bom" jsonb NOT NULL,
	"solver_log" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_build_id_version_pk" PRIMARY KEY("build_id","version")
);
--> statement-breakpoint
CREATE TABLE "builds"."specs" (
	"build_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"data" jsonb NOT NULL,
	"confidence" double precision NOT NULL,
	"open_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "specs_build_id_version_pk" PRIMARY KEY("build_id","version")
);
--> statement-breakpoint
ALTER TABLE "users"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users"."sessions" ADD CONSTRAINT "sessions_active_tenant_id_tenants_id_fk" FOREIGN KEY ("active_tenant_id") REFERENCES "users"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users"."sessions" ADD CONSTRAINT "sessions_parent_session_id_sessions_id_fk" FOREIGN KEY ("parent_session_id") REFERENCES "users"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users"."tenant_members" ADD CONSTRAINT "tenant_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "users"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users"."tenant_members" ADD CONSTRAINT "tenant_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builds"."bodies" ADD CONSTRAINT "bodies_plan_fk" FOREIGN KEY ("build_id","plan_version") REFERENCES "builds"."plans"("build_id","version") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builds"."build_messages" ADD CONSTRAINT "build_messages_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "builds"."builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builds"."builds" ADD CONSTRAINT "builds_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "users"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builds"."builds" ADD CONSTRAINT "builds_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builds"."code_bundles" ADD CONSTRAINT "code_bundles_plan_fk" FOREIGN KEY ("build_id","plan_version") REFERENCES "builds"."plans"("build_id","version") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builds"."llm_calls" ADD CONSTRAINT "llm_calls_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "builds"."builds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builds"."llm_calls" ADD CONSTRAINT "llm_calls_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "users"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builds"."plans" ADD CONSTRAINT "plans_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "builds"."builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builds"."plans" ADD CONSTRAINT "plans_spec_fk" FOREIGN KEY ("build_id","spec_version") REFERENCES "builds"."specs"("build_id","version") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builds"."specs" ADD CONSTRAINT "specs_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "builds"."builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_codes_email_idx" ON "users"."email_codes" USING btree ("email");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "users"."sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_parent_session_id_idx" ON "users"."sessions" USING btree ("parent_session_id");--> statement-breakpoint
CREATE INDEX "tenant_members_user_id_idx" ON "users"."tenant_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_key" ON "users"."users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "build_messages_build_id_created_at_idx" ON "builds"."build_messages" USING btree ("build_id","created_at");--> statement-breakpoint
CREATE INDEX "builds_tenant_id_idx" ON "builds"."builds" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "builds_anon_owner_hash_idx" ON "builds"."builds" USING btree ("anon_owner_hash");--> statement-breakpoint
CREATE INDEX "builds_unclaimed_created_at_idx" ON "builds"."builds" USING btree ("created_at") WHERE "tenant_id" IS NULL;--> statement-breakpoint
CREATE INDEX "llm_calls_build_id_idx" ON "builds"."llm_calls" USING btree ("build_id");--> statement-breakpoint
CREATE INDEX "llm_calls_tenant_id_created_at_idx" ON "builds"."llm_calls" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "llm_calls_anon_owner_hash_idx" ON "builds"."llm_calls" USING btree ("anon_owner_hash");