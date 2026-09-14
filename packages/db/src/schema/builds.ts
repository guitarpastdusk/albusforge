import { sql } from "drizzle-orm";
import {
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, oneOf, updatedAt } from "./columns.js";
import { tenants, users } from "./users.js";

/** A build and its versioned artifacts, plus LLM spend. */
export const buildsSchema = pgSchema("builds");

// ARCHITECTURE.md §5. ASK-TO-ENCLOSURE.md §5 proposes replacing coding|bodying
// with `building` before M4, which is why this is text + CHECK.
export const BUILD_STATUSES = ["asking", "specifying", "planning", "coding", "bodying", "ready", "ordered"] as const;
export type BuildStatus = (typeof BUILD_STATUSES)[number];

export const MESSAGE_ROLES = ["user", "assistant"] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

export const ARTIFACT_STATUSES = ["pending", "running", "passed", "failed"] as const;
export type ArtifactStatus = (typeof ARTIFACT_STATUSES)[number];

export const builds = buildsSchema.table(
  "builds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // RESTRICT: deleting a tenant that still owns builds (and later orders and
    // devices) must be an explicit operation, not a cascade.
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "restrict" }),
    anonOwnerHash: text("anon_owner_hash"),
    // The build belongs to the tenant; the creator is only a record.
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    status: text("status", { enum: BUILD_STATUSES }).notNull().default("asking"),
    askText: text("ask_text").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Every build has one owner or the other (ADR 0009, PORTAL.md §5).
    check("builds_owner_check", sql`"tenant_id" IS NOT NULL OR "anon_owner_hash" IS NOT NULL`),
    check("builds_status_check", oneOf("status", BUILD_STATUSES)),
    index("builds_tenant_id_idx").on(t.tenantId),
    index("builds_anon_owner_hash_idx").on(t.anonOwnerHash),
    // The 30-day expiry job scans only unclaimed builds.
    index("builds_unclaimed_created_at_idx").on(t.createdAt).where(sql`"tenant_id" IS NULL`),
  ],
);

// Versioned artifacts below cascade with their build: deleting an expired
// anonymous build removes its transcript, specs and plans with it.

export const buildMessages = buildsSchema.table(
  "build_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    buildId: uuid("build_id")
      .notNull()
      .references(() => builds.id, { onDelete: "cascade" }),
    role: text("role", { enum: MESSAGE_ROLES }).notNull(),
    text: text("text").notNull(),
    // Client-generated, so a double submit is idempotent. Null on assistant
    // messages; NULLs never collide in a unique constraint.
    clientMessageId: text("client_message_id"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("build_messages_client_message_id_key").on(t.buildId, t.clientMessageId),
    index("build_messages_build_id_created_at_idx").on(t.buildId, t.createdAt),
    check("build_messages_role_check", oneOf("role", MESSAGE_ROLES)),
  ],
);

export const specs = buildsSchema.table(
  "specs",
  {
    buildId: uuid("build_id")
      .notNull()
      .references(() => builds.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    data: jsonb("data").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    openQuestions: jsonb("open_questions").notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.buildId, t.version] })],
);

export const plans = buildsSchema.table(
  "plans",
  {
    buildId: uuid("build_id")
      .notNull()
      .references(() => builds.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    specVersion: integer("spec_version").notNull(),
    // Immutable {part_id, version} pins.
    partVersions: jsonb("part_versions").notNull(),
    wiringGraph: jsonb("wiring_graph").notNull(),
    powerBudget: jsonb("power_budget").notNull(),
    bom: jsonb("bom").notNull(),
    solverLog: jsonb("solver_log"),
    // Versioned immutable solver/evidence envelope; null identifies legacy rows.
    metadata: jsonb("metadata"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedBy: uuid("accepted_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.buildId, t.version] }),
    uniqueIndex("plans_one_accepted_spec_idx").on(t.buildId, t.specVersion).where(sql`${t.acceptedAt} IS NOT NULL`),
    check("plans_acceptance_metadata_check", sql`${t.acceptedAt} IS NULL OR ${t.metadata} IS NOT NULL`),
    foreignKey({
      name: "plans_spec_fk",
      columns: [t.buildId, t.specVersion],
      foreignColumns: [specs.buildId, specs.version],
    }).onDelete("cascade"),
  ],
);

// code_bundles and bodies carry their own status so the two stages can join on
// the current plan (ASK-TO-ENCLOSURE.md §5). `status` replaces §5's compile_status.

export const codeBundles = buildsSchema.table(
  "code_bundles",
  {
    buildId: uuid("build_id").notNull(),
    version: integer("version").notNull(),
    planVersion: integer("plan_version").notNull(),
    status: text("status", { enum: ARTIFACT_STATUSES }).notNull().default("pending"),
    storageRef: text("storage_ref"),
    compileLog: jsonb("compile_log"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.buildId, t.version] }),
    foreignKey({
      name: "code_bundles_plan_fk",
      columns: [t.buildId, t.planVersion],
      foreignColumns: [plans.buildId, plans.version],
    }).onDelete("cascade"),
    check("code_bundles_status_check", oneOf("status", ARTIFACT_STATUSES)),
  ],
);

export const bodies = buildsSchema.table(
  "bodies",
  {
    buildId: uuid("build_id").notNull(),
    version: integer("version").notNull(),
    planVersion: integer("plan_version").notNull(),
    status: text("status", { enum: ARTIFACT_STATUSES }).notNull().default("pending"),
    stepRef: text("step_ref"),
    stlRefs: jsonb("stl_refs"),
    lintReport: jsonb("lint_report"),
    serial: text("serial"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.buildId, t.version] }),
    foreignKey({
      name: "bodies_plan_fk",
      columns: [t.buildId, t.planVersion],
      foreignColumns: [plans.buildId, plans.version],
    }).onDelete("cascade"),
    check("bodies_status_check", oneOf("status", ARTIFACT_STATUSES)),
  ],
);

// Internal spend attribution (ARCHITECTURE.md §12.4). SET NULL, not CASCADE:
// usage outlives an expired build or a deleted tenant as platform cost (ADR 0009).
export const llmCalls = buildsSchema.table(
  "llm_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    buildId: uuid("build_id").references(() => builds.id, { onDelete: "set null" }),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "set null" }),
    anonOwnerHash: text("anon_owner_hash"),
    stage: text("stage").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadInputTokens: integer("cache_read_input_tokens").notNull().default(0),
    cacheCreationInputTokens: integer("cache_creation_input_tokens").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull(),
    stopReason: text("stop_reason"),
    createdAt: createdAt(),
  },
  (t) => [
    index("llm_calls_build_id_idx").on(t.buildId),
    // GET /v1/usage: the tenant's calls in the current period.
    index("llm_calls_tenant_id_created_at_idx").on(t.tenantId, t.createdAt),
    // The claim transaction re-attributes these by hash.
    index("llm_calls_anon_owner_hash_idx").on(t.anonOwnerHash),
  ],
);
