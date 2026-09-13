/*
 * `builds.builds`, `builds.build_messages` and `builds.specs` for the anonymous
 * chat routes. Every read that takes a build id is scoped by the caller's
 * anonymous owner hash in the route, via findOwnedBuild, before anything else.
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

export interface ChatStore {
  /** Inserts the build (status `asking`) and its first user message in one transaction. */
  createBuild(input: { ownerHash: string; askText: string; clientMessageId: string | null }): Promise<{ build: BuildRow; message: MessageRow }>;
  /** A build created by this owner whose first message carries the client message id. */
  findBuildByFirstMessage(ownerHash: string, clientMessageId: string): Promise<BuildRow | null>;
  /** The build when it is unclaimed and its anon_owner_hash matches; otherwise null. */
  findOwnedBuild(id: string, ownerHash: string): Promise<BuildRow | null>;
  latestSpec(buildId: string): Promise<SpecRow | null>;
  buildState(buildId: string): Promise<BuildState | null>;
  /** Oldest first. */
  listMessages(buildId: string): Promise<MessageRow[]>;
  findMessageByClientId(buildId: string, clientMessageId: string): Promise<MessageRow | null>;
  /** The newest message, and whether it was created less than `withinS` seconds ago by the database clock. */
  lastMessage(buildId: string, withinS: number): Promise<(MessageRow & { recent: boolean }) | null>;
  /** Inserts a user message, or returns the one already stored with that client message id. */
  insertUserMessage(buildId: string, text: string, clientMessageId: string): Promise<{ message: MessageRow; created: boolean }>;
  /** Messages with created_at later than `after` minus `lookbackMs` (all when `after` is absent), oldest first. */
  messagesSince(buildId: string, after: Cursor | undefined, lookbackMs: number): Promise<MessageRow[]>;
}

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

export function createChatStore(db: Db): ChatStore {
  const findMessageByClientId = async (buildId: string, clientMessageId: string) => {
    const [row] = await db
      .select(messageColumns)
      .from(buildMessages)
      .where(and(eq(buildMessages.buildId, buildId), eq(buildMessages.clientMessageId, clientMessageId)))
      .limit(1);
    return row ?? null;
  };

  return {
    async createBuild({ ownerHash, askText, clientMessageId }) {
      return db.transaction(async (tx) => {
        const [build] = await tx.insert(builds).values({ anonOwnerHash: ownerHash, askText, status: "asking" }).returning(buildColumns);
        const [message] = await tx
          .insert(buildMessages)
          .values({ buildId: build!.id, role: "user", text: askText, clientMessageId })
          .returning(messageColumns);
        return { build: build!, message: message! };
      });
    },

    async findBuildByFirstMessage(ownerHash, clientMessageId) {
      const [row] = await db
        .select(buildColumns)
        .from(builds)
        .innerJoin(buildMessages, eq(buildMessages.buildId, builds.id))
        .where(
          and(
            eq(builds.anonOwnerHash, ownerHash),
            isNull(builds.tenantId),
            eq(buildMessages.clientMessageId, clientMessageId),
            eq(buildMessages.role, "user"),
            sql`${buildMessages.text} = ${builds.askText}`,
          ),
        )
        .orderBy(asc(builds.createdAt))
        .limit(1);
      return row ?? null;
    },

    async findOwnedBuild(id, ownerHash) {
      if (!isUuid(id)) return null;
      const [row] = await db
        .select(buildColumns)
        .from(builds)
        .where(and(eq(builds.id, id), eq(builds.anonOwnerHash, ownerHash), isNull(builds.tenantId)))
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

    async buildState(buildId) {
      const [row] = await db
        .select({
          status: builds.status,
          specVersion: sql<number | null>`(select max(${specs.version}) from ${specs} where ${specs.buildId} = ${builds.id})`,
        })
        .from(builds)
        .where(eq(builds.id, buildId))
        .limit(1);
      return row ? { status: row.status, specVersion: row.specVersion === null ? null : Number(row.specVersion) } : null;
    },

    async listMessages(buildId) {
      return db
        .select(messageColumns)
        .from(buildMessages)
        .where(eq(buildMessages.buildId, buildId))
        .orderBy(asc(buildMessages.createdAt), asc(buildMessages.id));
    },

    findMessageByClientId,

    async lastMessage(buildId, withinS) {
      const [row] = await db
        .select({ ...messageColumns, recent: sql<boolean>`${buildMessages.createdAt} > now() - make_interval(secs => ${withinS})` })
        .from(buildMessages)
        .where(eq(buildMessages.buildId, buildId))
        .orderBy(desc(buildMessages.createdAt), desc(buildMessages.id))
        .limit(1);
      return row ?? null;
    },

    async insertUserMessage(buildId, text, clientMessageId) {
      const [inserted] = await db
        .insert(buildMessages)
        .values({ buildId, role: "user", text, clientMessageId })
        .onConflictDoNothing({ target: [buildMessages.buildId, buildMessages.clientMessageId] })
        .returning(messageColumns);
      if (inserted) return { message: inserted, created: true };
      const existing = await findMessageByClientId(buildId, clientMessageId);
      if (!existing) throw new Error("build message conflict without a stored message");
      return { message: existing, created: false };
    },

    async messagesSince(buildId, after, lookbackMs) {
      const since =
        after === undefined
          ? undefined
          : sql`${buildMessages.createdAt} > timestamptz 'epoch' + make_interval(secs => ${Number(after.micros - BigInt(lookbackMs) * 1000n) / 1e6})`;
      return db
        .select(messageColumns)
        .from(buildMessages)
        .where(and(eq(buildMessages.buildId, buildId), since))
        .orderBy(asc(buildMessages.createdAt), asc(buildMessages.id));
    },
  };
}
