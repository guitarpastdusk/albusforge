/*
 * `builds.builds`, `builds.build_messages` and `builds.specs` for the anonymous
 * chat routes.
 *
 * Every write that decides something from what it read runs in one
 * transaction under a lock, so concurrent requests on any number of instances
 * agree: creating a build holds an advisory lock on (owner, client message
 * id), and submitting a message locks the build row. Reads that an open event
 * stream repeats are scoped by owner hash and unclaimed state in the query
 * itself, so a claim takes effect on the very next poll.
 */
import { buildMessages, builds, type BuildStatus, type Db, type MessageRole, specs } from "@albusforge/db";
import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";

/**
 * Who may read a build: the tenant of a live session, the hash of an
 * anonymous owner cookie, or both when a signed-in browser still carries an
 * anonymous cookie. A build matches when its tenant is `tenantId`, or when it
 * is unclaimed and carries `anonHash`.
 */
export interface Owner {
  tenantId: string | null;
  anonHash: string | null;
}

/** One string per owner for in-memory limits: the tenant when signed in, else the anonymous hash. */
export const ownerKey = (owner: Owner): string => (owner.tenantId !== null ? `tenant:${owner.tenantId}` : `anon:${owner.anonHash ?? ""}`);

export interface BuildRow {
  id: string;
  status: BuildStatus;
  askText: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MessageRow {
  id: string;
  buildId: string;
  role: MessageRole;
  text: string;
  clientMessageId: string | null;
  createdAt: Date;
  /** SSE event id: see parseCursor. */
  cursor: string;
}

export interface SpecRow {
  version: number;
  data: unknown;
}

export interface BuildState {
  status: BuildStatus;
  specVersion: number | null;
}

/**
 * A message's position: `<created_at as integer microseconds since the Unix
 * epoch>.<message uuid>`, ordered by (created_at, id). Postgres keeps
 * microseconds, which a JS Date would lose, so the cursor is computed in SQL.
 */
export interface Cursor {
  micros: bigint;
  id: string;
}

const CURSOR_PATTERN = /^(\d{1,19})\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export function parseCursor(value: string | undefined): Cursor | undefined {
  const match = CURSOR_PATTERN.exec(value?.trim() ?? "");
  return match ? { micros: BigInt(match[1]!), id: match[2]! } : undefined;
}

/** (micros, id) order, the same as Postgres' (created_at, uuid) order. */
export function compareCursors(a: Cursor, b: Cursor): number {
  if (a.micros !== b.micros) return a.micros < b.micros ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export type CreateBuildResult = { kind: "created"; build: BuildRow; message: MessageRow } | { kind: "replayed"; build: BuildRow };

export type SubmitMessageResult =
  | { kind: "created"; message: MessageRow }
  | { kind: "replayed"; message: MessageRow }
  | { kind: "pending"; pendingMessageId: string }
  | { kind: "not_found" };

export interface ChatStore {
  /**
   * In one transaction: with a client message id, lock (owner, id) and return
   * the build already created from it; otherwise call `admit` (which throws to
   * refuse, rolling back) and insert the build (status `asking`) with its first
   * user message. `isNewOwner` is true when no build carries the owner hash yet.
   */
  createBuild(input: {
    /** A tenant owner stores `tenant_id`; an anonymous one stores `anon_owner_hash`. A tenant wins when both are present. */
    owner: Owner;
    askText: string;
    clientMessageId: string | null;
    admit: (owner: { isNewOwner: boolean }) => void;
  }): Promise<CreateBuildResult>;
  /** The build when the owner holds it (see Owner); otherwise null. */
  findOwnedBuild(id: string, owner: Owner): Promise<BuildRow | null>;
  /** The tenant's builds, most recently updated first. */
  listBuilds(tenantId: string): Promise<BuildRow[]>;
  latestSpec(buildId: string): Promise<SpecRow | null>;
  /** Null once the build is gone or no longer held by this owner. */
  buildState(buildId: string, owner: Owner): Promise<BuildState | null>;
  /** Oldest first; empty unless the owner still holds the build. */
  listMessages(buildId: string, owner: Owner): Promise<MessageRow[]>;
  /** The newest message, and whether it was created less than `withinS` seconds ago by the database clock. */
  lastMessage(buildId: string, withinS: number): Promise<(MessageRow & { recent: boolean }) | null>;
  /**
   * In one transaction holding the build row lock: the stored message for a
   * repeated client message id; `pending` when the newest message is a user
   * message younger than `pendingWithinS`; otherwise `admit` (throws to
   * refuse) and insert.
   */
  submitUserMessage(input: {
    buildId: string;
    owner: Owner;
    text: string;
    clientMessageId: string;
    pendingWithinS: number;
    admit: () => void;
  }): Promise<SubmitMessageResult>;
  /**
   * Messages with created_at later than `after` minus `lookbackMs` (all when
   * `after` is absent), oldest first; empty unless the owner still holds the build.
   */
  messagesSince(buildId: string, owner: Owner, after: Cursor | undefined, lookbackMs: number): Promise<MessageRow[]>;
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Queryable = Db | Tx;

const cursorSql = sql<string>`((extract(epoch from ${buildMessages.createdAt}) * 1000000)::bigint)::text || '.' || ${buildMessages.id}::text`;

const messageColumns = {
  id: buildMessages.id,
  buildId: buildMessages.buildId,
  role: buildMessages.role,
  text: buildMessages.text,
  clientMessageId: buildMessages.clientMessageId,
  createdAt: buildMessages.createdAt,
  cursor: cursorSql,
};

const buildColumns = {
  id: builds.id,
  status: builds.status,
  askText: builds.askText,
  createdAt: builds.createdAt,
  updatedAt: builds.updatedAt,
};

/** Postgres raises 22P02 for a malformed uuid; a non-uuid id simply isn't found. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string) => UUID.test(value);

/** Held by the tenant, or unclaimed and still carrying the anonymous owner's hash. Matches nothing for an empty owner. */
function ownedBy(owner: Owner) {
  const byTenant = owner.tenantId === null ? undefined : eq(builds.tenantId, owner.tenantId);
  const byHash = owner.anonHash === null ? undefined : and(eq(builds.anonOwnerHash, owner.anonHash), isNull(builds.tenantId));
  if (byTenant && byHash) return or(byTenant, byHash);
  return byTenant ?? byHash ?? sql`false`;
}

async function findBuildByFirstMessage(db: Queryable, owner: Owner, clientMessageId: string): Promise<BuildRow | null> {
  const [row] = await db
    .select(buildColumns)
    .from(builds)
    .innerJoin(buildMessages, eq(buildMessages.buildId, builds.id))
    .where(
      and(
        ownedBy(owner),
        eq(buildMessages.clientMessageId, clientMessageId),
        eq(buildMessages.role, "user"),
        sql`${buildMessages.text} = ${builds.askText}`,
      ),
    )
    .orderBy(asc(builds.createdAt))
    .limit(1);
  return row ?? null;
}

async function lastMessageOf(db: Queryable, buildId: string, withinS: number) {
  const [row] = await db
    .select({ ...messageColumns, recent: sql<boolean>`${buildMessages.createdAt} > now() - make_interval(secs => ${withinS})` })
    .from(buildMessages)
    .where(eq(buildMessages.buildId, buildId))
    .orderBy(desc(buildMessages.createdAt), desc(buildMessages.id))
    .limit(1);
  return row ?? null;
}

export function createChatStore(db: Db): ChatStore {
  return {
    async createBuild({ owner, askText, clientMessageId, admit }) {
      return db.transaction(async (tx): Promise<CreateBuildResult> => {
        if (clientMessageId !== null) {
          // Serializes every request for this (owner, client id) across instances until commit.
          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`create-build:${ownerKey(owner)}:${clientMessageId}`}, 0))`);
          const replayed = await findBuildByFirstMessage(tx, owner, clientMessageId);
          if (replayed) return { kind: "replayed", build: replayed };
        }
        let isNewOwner = false;
        if (owner.tenantId === null) {
          const [known] = await tx.select({ id: builds.id }).from(builds).where(eq(builds.anonOwnerHash, owner.anonHash!)).limit(1);
          isNewOwner = known === undefined;
        }
        admit({ isNewOwner });
        const ownership = owner.tenantId !== null ? { tenantId: owner.tenantId } : { anonOwnerHash: owner.anonHash };
        const [build] = await tx.insert(builds).values({ ...ownership, askText, status: "asking" }).returning(buildColumns);
        const [message] = await tx
          .insert(buildMessages)
          .values({ buildId: build!.id, role: "user", text: askText, clientMessageId })
          .returning(messageColumns);
        return { kind: "created", build: build!, message: message! };
      });
    },

    async findOwnedBuild(id, owner) {
      if (!isUuid(id)) return null;
      const [row] = await db
        .select(buildColumns)
        .from(builds)
        .where(and(eq(builds.id, id), ownedBy(owner)))
        .limit(1);
      return row ?? null;
    },

    async listBuilds(tenantId) {
      return db.select(buildColumns).from(builds).where(eq(builds.tenantId, tenantId)).orderBy(desc(builds.updatedAt), desc(builds.id));
    },

    async latestSpec(buildId) {
      const [row] = await db
        .select({ version: specs.version, data: specs.data })
        .from(specs)
        .where(eq(specs.buildId, buildId))
        .orderBy(desc(specs.version))
        .limit(1);
      return row ?? null;
    },

    async buildState(buildId, owner) {
      const [row] = await db
        .select({
          status: builds.status,
          specVersion: sql<number | null>`(select max(${specs.version}) from ${specs} where ${specs.buildId} = ${builds.id})`,
        })
        .from(builds)
        .where(and(eq(builds.id, buildId), ownedBy(owner)))
        .limit(1);
      return row ? { status: row.status, specVersion: row.specVersion === null ? null : Number(row.specVersion) } : null;
    },

    async listMessages(buildId, owner) {
      return db
        .select(messageColumns)
        .from(buildMessages)
        .innerJoin(builds, eq(builds.id, buildMessages.buildId))
        .where(and(eq(buildMessages.buildId, buildId), ownedBy(owner)))
        .orderBy(asc(buildMessages.createdAt), asc(buildMessages.id));
    },

    lastMessage: (buildId, withinS) => lastMessageOf(db, buildId, withinS),

    async submitUserMessage({ buildId, owner, text, clientMessageId, pendingWithinS, admit }) {
      if (!isUuid(buildId)) return { kind: "not_found" };
      return db.transaction(async (tx): Promise<SubmitMessageResult> => {
        // Every submission for this build waits here, on any instance, until the holder commits.
        const [owned] = await tx
          .select({ id: builds.id })
          .from(builds)
          .where(and(eq(builds.id, buildId), ownedBy(owner)))
          .for("update");
        if (!owned) return { kind: "not_found" };

        const [replayed] = await tx
          .select(messageColumns)
          .from(buildMessages)
          .where(and(eq(buildMessages.buildId, buildId), eq(buildMessages.clientMessageId, clientMessageId)))
          .limit(1);
        if (replayed) return { kind: "replayed", message: replayed };

        const last = await lastMessageOf(tx, buildId, pendingWithinS);
        if (last && last.role === "user" && last.recent) return { kind: "pending", pendingMessageId: last.id };

        admit();
        const [message] = await tx.insert(buildMessages).values({ buildId, role: "user", text, clientMessageId }).returning(messageColumns);
        return { kind: "created", message: message! };
      });
    },

    async messagesSince(buildId, owner, after, lookbackMs) {
      const since =
        after === undefined
          ? undefined
          : sql`${buildMessages.createdAt} > timestamptz 'epoch' + make_interval(secs => ${Number(after.micros - BigInt(lookbackMs) * 1000n) / 1e6})`;
      return db
        .select(messageColumns)
        .from(buildMessages)
        .innerJoin(builds, eq(builds.id, buildMessages.buildId))
        .where(and(eq(buildMessages.buildId, buildId), ownedBy(owner), since))
        .orderBy(asc(buildMessages.createdAt), asc(buildMessages.id));
    },
  };
}
