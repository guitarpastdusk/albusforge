/*
 * `users.email_codes`, `users.users`, `users.tenants`, `users.tenant_members`
 * and `users.sessions` for the sign-in routes (ADR 0008, ADR 0009).
 *
 * A code is stored as SHA-256(`<code row id>:<code>`): the row id is random,
 * so a leaked table can't be reversed with one precomputed list of the million
 * possible codes. Verifying holds an advisory lock per email, so concurrent
 * guesses count attempts exactly, and the whole claim (user, tenant, session,
 * anonymous builds and their spend) commits or rolls back together.
 */
import { createHash, randomInt, randomUUID } from "node:crypto";
import { builds, type Db, emailCodes, llmCalls, sessions, tenantMembers, tenants, type TenantRole, users } from "@albusforge/db";
import type { Me, TenantMembership } from "@albusforge/schema";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { hashSessionToken } from "./session";

/** ADR 0008: valid for 10 minutes. */
export const CODE_TTL_MS = 10 * 60_000;
/** ADR 0008: at most 5 wrong attempts, then the code is dead. */
export const CODE_MAX_ATTEMPTS = 5;
/** Default name of the tenant created at first sign-in (ADR 0009). */
export const PERSONAL_TENANT_NAME = "Personal";

export type VerifyResult =
  | { kind: "verified"; me: Me; sessionToken: string; claimed: { builds: number; llmCalls: number } }
  | { kind: "rejected" };

export interface AuthStore {
  /**
   * Stores a fresh code for the email, invalidating any earlier live code, and
   * returns the plain code for the email adapter. Never returned again.
   */
  issueCode(email: string, now?: Date): Promise<{ code: string; expiresAt: Date }>;
  /**
   * In one transaction under a per-email lock: check the code against the
   * newest live one, counting a miss as an attempt (the fifth kills the code).
   * On a hit: consume it, find or create the user and their personal tenant,
   * open a session (its active tenant is that of `currentSessionToken` when
   * it belongs to the same user, otherwise the user's oldest membership),
   * and move builds and llm_calls carrying `anonOwnerHash` into that tenant.
   */
  verifyCode(input: {
    email: string;
    code: string;
    anonOwnerHash: string | undefined;
    currentSessionToken: string | undefined;
    sessionMaxAgeS: number;
    now?: Date;
  }): Promise<VerifyResult>;
  /** The live session's Me, or null when the token is unknown, revoked or expired. */
  me(sessionToken: string): Promise<Me | null>;
  /** The live session's active tenant, or null: one indexed lookup for the tenant-scoped routes. */
  sessionTenant(sessionToken: string): Promise<string | null>;
  /**
   * Revokes the token's session together with its whole family: the root of
   * its parent chain and everything descended from it (ADR 0009). Returns how
   * many sessions it revoked; 0 for an unknown or already revoked token.
   */
  revokeSessionFamily(sessionToken: string): Promise<number>;
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Queryable = Db | Tx;

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export function hashCode(codeId: string, code: string): string {
  return createHash("sha256").update(`${codeId}:${code}`, "utf8").digest("hex");
}

/** Six digits with leading zeros, from a CSPRNG. */
export function randomCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

const membershipColumns = {
  id: tenants.id,
  name: tenants.name,
  slug: tenants.slug,
  role: tenantMembers.role,
  createdAt: tenantMembers.createdAt,
};

async function membershipsOf(db: Queryable, userId: string): Promise<(TenantMembership & { createdAt: Date })[]> {
  const rows = await db
    .select(membershipColumns)
    .from(tenantMembers)
    .innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId))
    .where(eq(tenantMembers.userId, userId))
    .orderBy(tenantMembers.createdAt, tenants.id);
  return rows.map((row) => ({ id: row.id, name: row.name, slug: row.slug, role: row.role as TenantRole, createdAt: row.createdAt }));
}

async function meOf(db: Queryable, user: { id: string; email: string }, activeTenantId: string): Promise<Me | null> {
  const memberships = await membershipsOf(db, user.id);
  const active = memberships.find((m) => m.id === activeTenantId);
  if (!active) return null;
  const strip = ({ id, name, slug, role }: (typeof memberships)[number]): TenantMembership => ({ id, name, slug, role });
  return { user: { id: user.id, email: user.email, display_name: null }, tenant: strip(active), tenants: memberships.map(strip) };
}

/** The live session for a token, with its user. */
async function liveSession(db: Queryable, token: string) {
  const [row] = await db
    .select({ id: sessions.id, userId: sessions.userId, activeTenantId: sessions.activeTenantId, email: users.email })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashSessionToken(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, sql`now()`)))
    .limit(1);
  return row ?? null;
}

export function createAuthStore(db: Db, { newSessionToken }: { newSessionToken: () => string }): AuthStore {
  return {
    async issueCode(rawEmail, now = new Date()) {
      const email = normalizeEmail(rawEmail);
      const code = randomCode();
      const id = randomUUID();
      const expiresAt = new Date(now.getTime() + CODE_TTL_MS);
      await db.transaction(async (tx) => {
        // A new request invalidates the previous code (ADR 0008).
        await tx
          .update(emailCodes)
          .set({ consumedAt: now })
          .where(and(eq(emailCodes.email, email), isNull(emailCodes.consumedAt)));
        await tx.insert(emailCodes).values({ id, email, codeHash: hashCode(id, code), expiresAt });
      });
      return { code, expiresAt };
    },

    async verifyCode({ email: rawEmail, code, anonOwnerHash, currentSessionToken, sessionMaxAgeS, now = new Date() }) {
      const email = normalizeEmail(rawEmail);
      return db.transaction(async (tx): Promise<VerifyResult> => {
        // Every verify for this email waits here, on any instance, so attempts are counted exactly.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`auth-code:${email}`}, 0))`);

        const [live] = await tx
          .select({ id: emailCodes.id, codeHash: emailCodes.codeHash, attempts: emailCodes.attempts })
          .from(emailCodes)
          .where(and(eq(emailCodes.email, email), isNull(emailCodes.consumedAt), gt(emailCodes.expiresAt, now)))
          .orderBy(desc(emailCodes.createdAt))
          .limit(1);
        if (!live) return { kind: "rejected" };

        if (hashCode(live.id, code) !== live.codeHash) {
          const attempts = live.attempts + 1;
          // Committed, not rolled back: the miss must count even though the request fails.
          await tx
            .update(emailCodes)
            .set({ attempts, ...(attempts >= CODE_MAX_ATTEMPTS ? { consumedAt: now } : {}) })
            .where(eq(emailCodes.id, live.id));
          return { kind: "rejected" };
        }
        await tx.update(emailCodes).set({ consumedAt: now }).where(eq(emailCodes.id, live.id));

        // Find or create the user. The unique index is on lower(email), so a
        // concurrent first sign-in for the same address makes one of them wait.
        await tx.insert(users).values({ email }).onConflictDoNothing();
        const [user] = await tx
          .select({ id: users.id, email: users.email })
          .from(users)
          .where(sql`lower(${users.email}) = ${email}`)
          .limit(1);
        if (!user) throw new Error("user row missing after insert");

        let memberships = await membershipsOf(tx, user.id);
        if (memberships.length === 0) {
          // First sign-in: a personal tenant with the user as admin (ADR 0009).
          const [tenant] = await tx.insert(tenants).values({ name: PERSONAL_TENANT_NAME }).returning({ id: tenants.id });
          await tx.insert(tenantMembers).values({ tenantId: tenant!.id, userId: user.id, role: "admin" });
          memberships = await membershipsOf(tx, user.id);
        }

        // An already signed-in user verifying again keeps their active tenant.
        const current = currentSessionToken === undefined ? null : await liveSession(tx, currentSessionToken);
        const activeTenantId =
          current !== null && current.userId === user.id && memberships.some((m) => m.id === current.activeTenantId)
            ? current.activeTenantId
            : memberships[0]!.id;

        const sessionToken = newSessionToken();
        await tx.insert(sessions).values({
          tokenHash: hashSessionToken(sessionToken),
          userId: user.id,
          activeTenantId,
          expiresAt: new Date(now.getTime() + sessionMaxAgeS * 1000),
        });

        // Claim anonymous work (PORTAL.md §5): builds, then the spend they incurred.
        let claimed = { builds: 0, llmCalls: 0 };
        if (anonOwnerHash !== undefined) {
          const claimedBuilds = await tx
            .update(builds)
            .set({ tenantId: activeTenantId, anonOwnerHash: null, updatedAt: now })
            .where(and(eq(builds.anonOwnerHash, anonOwnerHash), isNull(builds.tenantId)))
            .returning({ id: builds.id });
          const claimedCalls = await tx
            .update(llmCalls)
            .set({ tenantId: activeTenantId, anonOwnerHash: null })
            .where(and(eq(llmCalls.anonOwnerHash, anonOwnerHash), isNull(llmCalls.tenantId)))
            .returning({ id: llmCalls.id });
          claimed = { builds: claimedBuilds.length, llmCalls: claimedCalls.length };
        }

        const me = await meOf(tx, user, activeTenantId);
        if (!me) throw new Error("active tenant missing after sign-in");
        return { kind: "verified", me, sessionToken, claimed };
      });
    },

    async me(token) {
      const session = await liveSession(db, token);
      if (!session) return null;
      return meOf(db, { id: session.userId, email: session.email }, session.activeTenantId);
    },

    async sessionTenant(token) {
      const [row] = await db
        .select({ activeTenantId: sessions.activeTenantId })
        .from(sessions)
        .where(and(eq(sessions.tokenHash, hashSessionToken(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, sql`now()`)))
        .limit(1);
      return row?.activeTenantId ?? null;
    },

    async revokeSessionFamily(token) {
      const session = await liveSession(db, token);
      if (!session) return 0;
      // Up the parent chain to the root, then down to every descendant.
      const revoked = await db.execute<{ id: string }>(sql`
        with recursive up as (
          select id, parent_session_id from ${sessions} where id = ${session.id}
          union all
          select s.id, s.parent_session_id from ${sessions} s join up on s.id = up.parent_session_id
        ),
        root as (select id from up where parent_session_id is null),
        family as (
          select id from root
          union all
          select s.id from ${sessions} s join family on s.parent_session_id = family.id
        )
        update ${sessions} set revoked_at = now()
        where id in (select id from family) and revoked_at is null
        returning id
      `);
      return revoked.rowCount ?? revoked.rows.length;
    },
  };
}
