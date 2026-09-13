import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  index,
  integer,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, oneOf } from "./columns.js";

/** Accounts, tenants and sign-in (ADR 0008, ADR 0009). */
export const usersSchema = pgSchema("users");

export const TENANT_ROLES = ["admin", "operator", "viewer"] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];

export const users = usersSchema.table(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    createdAt: createdAt(),
  },
  // Unique on lower(email) so Ann@x.com and ann@x.com can never be two accounts.
  (t) => [uniqueIndex("users_email_lower_key").on(sql`lower(${t.email})`)],
);

export const tenants = usersSchema.table("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  // Null for a personal tenant served on the apex; set when a subdomain is assigned.
  slug: text("slug").unique("tenants_slug_key"),
  createdAt: createdAt(),
});

export const tenantMembers = usersSchema.table(
  "tenant_members",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: TENANT_ROLES }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.userId] }),
    // /v1/me lists every tenant a user belongs to.
    index("tenant_members_user_id_idx").on(t.userId),
    check("tenant_members_role_check", oneOf("role", TENANT_ROLES)),
  ],
);

export const sessions = usersSchema.table(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull().unique("sessions_token_hash_key"),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // A session scoped to a deleted tenant means nothing; the user signs in again.
    activeTenantId: uuid("active_tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    // Set by the apex → subdomain handoff; sign-out revokes the whole family.
    parentSessionId: uuid("parent_session_id").references((): AnyPgColumn => sessions.id, {
      onDelete: "cascade",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("sessions_user_id_idx").on(t.userId),
    index("sessions_parent_session_id_idx").on(t.parentSessionId),
  ],
);

// No FK to users: a code is issued before the account exists.
export const emailCodes = usersSchema.table(
  "email_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("email_codes_email_idx").on(t.email)],
);
