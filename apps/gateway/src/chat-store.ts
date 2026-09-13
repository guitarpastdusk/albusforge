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
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

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
    ownerHash: string;
    askText: string;
    clientMessageId: string | null;
    admit: (owner: { isNewOwner: boolean }) => void;
  }): Promise<CreateBuildResult>;
  /** The build when it is unclaimed and its anon_owner_hash matches; otherwise null. */
  findOwnedBuild(id: string, ownerHash: string): Promise<BuildRow | null>;
  latestSpec(buildId: string): Promise<SpecRow | null>;
  /** Null once the build is gone, claimed, or no longer carries this owner hash. */
  buildState(buildId: string, ownerHash: string): Promise<BuildState | null>;
  /** Oldest first; empty unless the owner still holds the build. */
  listMessages(buildId: string, ownerHash: string): Promise<MessageRow[]>;
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
    ownerHash: string;
    text: string;
    clientMessageId: string;
    pendingWithinS: number;
    admit: () => void;
  }): Promise<SubmitMessageResult>;
  /**
   * Messages with created_at later than `after` minus `lookbackMs` (all when
   * `after` is absent), oldest first; empty unless the owner still holds the build.
   */
  messagesSince(buildId: string, ownerHash: string, after: Cursor | undefined, lookbackMs: number): Promise<MessageRow[]>;
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

/** Unclaimed and still carrying this anonymous owner's hash. */
const ownedBy = (ownerHash: string) => and(eq(builds.anonOwnerHash, ownerHash), isNull(builds.tenantId));

async function findBuildByFirstMessage(db: Queryable, ownerHash: string, clientMessageId: string): Promise<BuildRow | null> {
  const [row] = await db
    .select(buildColumns)
    .from(builds)
    .innerJoin(buildMessages, eq(buildMessages.buildId, builds.id))
    .where(
      and(
        ownedBy(ownerHash),
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
    async createBuild({ ownerHash, askText, clientMessageId, admit }) {
      return db.transaction(async (tx): Promise<CreateBuildResult> => {
        if (clientMessageId !== null) {
          // Serializes every request for this (owner, client id) across instances until commit.
          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`create-build:${ownerHash}:${clientMessageId}`}, 0))`);
          const replayed = await findBuildByFirstMessage(tx, ownerHash, clientMessageId);
          if (replayed) return { kind: "replayed", build: replayed };
        }
        const [known] = await tx.select({ id: builds.id }).from(builds).where(eq(builds.anonOwnerHash, ownerHash)).limit(1);
        admit({ isNewOwner: known === undefined });
        const [build] = await tx.insert(builds).values({ anonOwnerHash: ownerHash, askText, status: "asking" }).returning(buildColumns);
        const [message] = await tx
          .insert(buildMessages)
          .values({ buildId: build!.id, role: "user", text: askText, clientMessageId })
          .returning(messageColumns);
        return { kind: "created", build: build!, message: message! };
      });
    },

    async findOwnedBuild(id, ownerHash) {
      if (!isUuid(id)) return null;
      const [row] = await db
        .select(buildColumns)
        .from(builds)
        .where(and(eq(builds.id, id), ownedBy(ownerHash)))
        .limit(1);
      return row ?? null;
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

    async buildState(buildId, ownerHash) {
      const [row] = await db
        .select({
          status: builds.status,
          specVersion: sql<number | null>`(select max(${specs.version}) from ${specs} where ${specs.buildId} = ${builds.id})`,
        })
        .from(builds)
        .where(and(eq(builds.id, buildId), ownedBy(ownerHash)))
        .limit(1);
      return row ? { status: row.status, specVersion: row.specVersion === null ? null : Number(row.specVersion) } : null;
    },

    async listMessages(buildId, ownerHash) {
      return db
        .select(messageColumns)
        .from(buildMessages)
        .innerJoin(builds, eq(builds.id, buildMessages.buildId))
        .where(and(eq(buildMessages.buildId, buildId), ownedBy(ownerHash)))
        .orderBy(asc(buildMessages.createdAt), asc(buildMessages.id));
    },

    lastMessage: (buildId, withinS) => lastMessageOf(db, buildId, withinS),

    async submitUserMessage({ buildId, ownerHash, text, clientMessageId, pendingWithinS, admit }) {
      if (!isUuid(buildId)) return { kind: "not_found" };
      return db.transaction(async (tx): Promise<SubmitMessageResult> => {
        // Every submission for this build waits here, on any instance, until the holder commits.
        const [owned] = await tx
          .select({ id: builds.id })
          .from(builds)
          .where(and(eq(builds.id, buildId), ownedBy(ownerHash)))
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

    async messagesSince(buildId, ownerHash, after, lookbackMs) {
      const since =
        after === undefined
          ? undefined
          : sql`${buildMessages.createdAt} > timestamptz 'epoch' + make_interval(secs => ${Number(after.micros - BigInt(lookbackMs) * 1000n) / 1e6})`;
      return db
        .select(messageColumns)
        .from(buildMessages)
        .innerJoin(builds, eq(builds.id, buildMessages.buildId))
        .where(and(eq(buildMessages.buildId, buildId), ownedBy(ownerHash), since))
        .orderBy(asc(buildMessages.createdAt), asc(buildMessages.id));
    },
  };
}
