import { buildMessages, builds, createClientDb, type Db, specs } from "@albusforge/db";
import { type IntakeTurnResponse, Spec } from "@albusforge/schema";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type pg from "pg";
import type { Log, TraceContext } from "./log";
import { FALLBACK_REPLY } from "./replies";
import { runTurn, type TurnContext, type TurnOutcome } from "./turn";

/**
 * POST /v1/turns: answer the latest unanswered user message on a build.
 *
 * Concurrency. A session-level advisory lock per build serializes answering.
 * A caller that can't take the lock returns noop: whoever holds it answers.
 * The holder re-checks for an unanswered message after releasing, so a message
 * that arrives while it works is never stranded between the holder's last
 * check and a late caller's failed try.
 *
 * Every answered user message gets exactly one assistant message: success,
 * refusal, limit, deadline and failure all end in the same write. The one way
 * out is that the write itself can't be made — the database is unavailable, or
 * this turn's connection couldn't be left clean — and then nothing is written
 * at all and the call is a 503 that gateway retries, which answers it once.
 *
 * One connection per turn, and every query the turn makes — the reads, the
 * token ceiling, metering, the final transaction — runs on the connection
 * that holds the lock. A turn that took a second connection for its queries
 * would deadlock against other turns as soon as the holders filled the pool:
 * each one holding a connection, each waiting for one. That happens before the
 * deadline race, so it would reject rather than write the fallback reply.
 * A turn therefore costs exactly one connection; the pool size is the limit on
 * concurrent builds, and a turn beyond it waits out `connectTimeoutMs` and
 * gets a 503 rather than taking part in a deadlock.
 */

export interface HandlerDeps {
  pool: pg.Pool;
  /** Everything about a turn that doesn't touch the database. */
  turn: Omit<TurnContext, "catalogue" | "meter" | "tokensUsed">;
  /** The turn's registry read, metering and ceiling read, bound to the turn's own connection. */
  bindDb: (db: Db) => Pick<TurnContext, "catalogue" | "meter" | "tokensUsed">;
  /** The whole turn, retries included. */
  deadlineMs: number;
  log: Log;
}

/** First key of the two-key advisory lock; the second is hashtext(build_id). Arbitrary, fixed. */
export const TURN_LOCK_CLASS = 424_200_001;
/** Turns one call answers at most, when messages keep arriving. */
const MAX_PASSES = 3;

type Answered = Extract<IntakeTurnResponse, { message_id: string }>;

export async function handleTurn(deps: HandlerDeps, buildId: string, trace?: TraceContext): Promise<IntakeTurnResponse | null> {
  const client = await deps.pool.connect();
  const { db, close } = createClientDb(client);
  let broken: Error | undefined;
  try {
    const [build] = await db.select({ id: builds.id }).from(builds).where(eq(builds.id, buildId));
    if (!build) return null;

    let last: Answered | undefined;
    let passes = 0;
    while (passes < MAX_PASSES) {
      const { rows } = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1, hashtext($2)) AS locked", [TURN_LOCK_CLASS, buildId]);
      if (!rows[0]?.locked) break;
      try {
        while (passes < MAX_PASSES) {
          const answered = await answerLatest(deps, client, db, buildId, trace);
          if (!answered) break;
          last = answered;
          passes++;
        }
      } finally {
        await client.query("SELECT pg_advisory_unlock($1, hashtext($2))", [TURN_LOCK_CLASS, buildId]).catch((error: Error) => {
          // Closing the connection releases a session lock, so discard the client.
          broken = error;
        });
      }
      if (broken || !(await latestIsUnanswered(db, buildId))) break;
    }
    return last ?? { noop: true };
  } catch (error) {
    broken ??= error as Error;
    throw error;
  } finally {
    // Nothing of this turn's may run on a connection someone else now owns.
    // A connection that can't be left clean is destroyed, not returned.
    await close().catch((error: Error) => {
      broken ??= error;
    });
    client.release(broken);
  }
}

async function latestMessage(db: Db, buildId: string) {
  const [latest] = await db
    .select({ id: buildMessages.id, role: buildMessages.role, createdAt: buildMessages.createdAt })
    .from(buildMessages)
    .where(eq(buildMessages.buildId, buildId))
    .orderBy(desc(buildMessages.createdAt), desc(buildMessages.id))
    .limit(1);
  return latest;
}

async function latestIsUnanswered(db: Db, buildId: string): Promise<boolean> {
  return (await latestMessage(db, buildId))?.role === "user";
}

/** Answers the latest message if it's from the user; undefined if there's nothing to answer. Needs the lock. */
async function answerLatest(deps: HandlerDeps, client: pg.PoolClient, db: Db, buildId: string, trace?: TraceContext): Promise<Answered | undefined> {
  const { log } = deps;
  const [build] = await db
    .select({ tenantId: builds.tenantId, anonOwnerHash: builds.anonOwnerHash })
    .from(builds)
    .where(eq(builds.id, buildId));
  if (!build) return undefined;

  const transcript = await db
    .select({ id: buildMessages.id, role: buildMessages.role, text: buildMessages.text, createdAt: buildMessages.createdAt })
    .from(buildMessages)
    .where(eq(buildMessages.buildId, buildId))
    .orderBy(asc(buildMessages.createdAt), asc(buildMessages.id));
  const target = transcript.at(-1);
  if (!target || target.role !== "user") return undefined;

  const [latestSpec] = await db
    .select({ version: specs.version, data: specs.data })
    .from(specs)
    .where(eq(specs.buildId, buildId))
    .orderBy(desc(specs.version))
    .limit(1);
  const previous = latestSpec ? Spec.parse(latestSpec.data) : null;
  const [{ rounds } = { rounds: 0 }] = await db
    .select({ rounds: sql<number>`count(*)::int` })
    .from(specs)
    .where(and(eq(specs.buildId, buildId), sql`jsonb_array_length(${specs.openQuestions}) > 0`));

  await db.update(builds).set({ status: "specifying", updatedAt: new Date() }).where(eq(builds.id, buildId));

  /*
   * The turn's own handle on the connection the lock is on.
   *
   * The deadline can land anywhere, including inside metering's transaction —
   * it takes the build row's lock, so ordinary contention can hold it past the
   * deadline. Handing the connection to the write below while that is still
   * outstanding is what makes the promise of exactly one assistant message
   * false: the abandoned statement hits `statement_timeout`, its transaction
   * is left aborted, and the write's `BEGIN` fails with 25P02.
   *
   * So the handle is closed on a controlled path before the write: it stops
   * new work, waits for what's outstanding to settle, then rolls back itself,
   * with Drizzle's own rollback fenced out so it can't race. If that can't be
   * done the close rejects, the connection is destroyed rather than reused,
   * and the turn ends as a 503 that gateway retries — no reply is written
   * here, and no half-written one is left behind.
   */
  const turnHandle = createClientDb(client);
  let outcome: TurnOutcome;
  try {
    outcome = await withDeadline(deps, buildId, trace, (signal) =>
      runTurn(
        { ...deps.turn, ...deps.bindDb(turnHandle.db) },
        {
          buildId,
          // What the build looks like now. Metering re-resolves the owner as it
          // inserts, so a sign-up during the call still gets the usage (ADR 0009).
          attribution: { buildId, tenantId: build.tenantId, anonOwnerHash: build.anonOwnerHash, trace },
          transcript: transcript.map((m) => ({ role: m.role, text: m.text })),
          previous,
          roundsUsed: rounds,
          signal,
        },
      ),
    );
  } finally {
    await turnHandle.close();
  }

  const idleStatus = previous?.settled ? "planning" : "asking";
  const reply = outcome.kind === "spec" ? outcome.decision.reply : outcome.reply;
  const status = outcome.kind === "spec" ? outcome.decision.status : idleStatus;

  const written = await db.transaction(async (tx) => {
    const [message] = await tx
      .insert(buildMessages)
      .values({
        buildId,
        role: "assistant",
        text: reply,
        // Directly after the message it answers, read in SQL (a JS Date drops the
        // microseconds). Not now(): a user message sent while this turn ran would
        // then sort before the reply and look answered.
        createdAt: sql`(SELECT ${buildMessages.createdAt} + interval '1 microsecond' FROM ${buildMessages} WHERE ${buildMessages.id} = ${target.id})`,
      })
      .returning({ id: buildMessages.id });

    let specVersion = latestSpec?.version ?? null;
    if (outcome.kind === "spec" && outcome.decision.newVersion) {
      specVersion = (latestSpec?.version ?? 0) + 1;
      await tx.insert(specs).values({
        buildId,
        version: specVersion,
        data: outcome.decision.spec,
        confidence: outcome.decision.confidence,
        openQuestions: outcome.decision.spec.open_questions,
      });
    }
    await tx.update(builds).set({ status, updatedAt: new Date() }).where(eq(builds.id, buildId));
    return { message_id: message!.id, spec_version: specVersion, status };
  });

  log("INFO", "turn answered", {
    trace,
    fields: { buildId, outcome: outcome.kind === "spec" ? "spec" : outcome.reason, status, specVersion: written.spec_version },
  });
  return written;
}

/**
 * Runs the turn under the deadline. The signal cancels the model request; the
 * race also covers anything that ignores it, and any error becomes the
 * fallback reply, so the caller always has something to write.
 */
async function withDeadline(
  deps: HandlerDeps,
  buildId: string,
  trace: TraceContext | undefined,
  run: (signal: AbortSignal) => Promise<TurnOutcome>,
): Promise<TurnOutcome> {
  const controller = new AbortController();
  const deadline: TurnOutcome = { kind: "reply", reason: "deadline", reply: FALLBACK_REPLY };
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<TurnOutcome>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(deadline);
    }, deps.deadlineMs);
  });
  try {
    return await Promise.race([
      run(controller.signal).catch((error: unknown): TurnOutcome => {
        deps.log("ERROR", "turn failed", { error, trace, fields: { buildId } });
        return { kind: "reply", reason: "error", reply: FALLBACK_REPLY };
      }),
      expired,
    ]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
