import { type ClientDb, buildMessages, builds, createClientDb, type Db, specs } from "@albusforge/db";
import { type IntakeTurnResponse, Spec } from "@albusforge/schema";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type pg from "pg";
import { DatabaseUnavailableError } from "./db-errors";
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
 * Budget. That handover only works if the 503 arrives while gateway is still
 * listening: its attempt deadline is 50 s and it deliberately doesn't retry
 * its own timeout, because a turn it stopped waiting for may still be running.
 * So the whole call — the reads, the model deadline, cleanup and the final
 * write — is spent against one budget that ends inside gateway's, and every
 * step that could block gets what is left of it rather than a timeout of its
 * own. When it runs out, the connection is destroyed instead of being asked
 * one more question: that drops the advisory lock too, so the retry finds the
 * build free rather than a noop from a lock nobody is using any more.
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
  /** The model call, retries included. Never longer than what the budget leaves for it. */
  deadlineMs: number;
  /**
   * The whole call, from the first query to the last. Must end inside the
   * caller's attempt deadline. Defaults to the turn plus a fifteenth of it —
   * the 45 s / 3 s the service is configured with (config.ts).
   */
  budgetMs?: number;
  log: Log;
}

/** First key of the two-key advisory lock; the second is hashtext(build_id). Arbitrary, fixed. */
export const TURN_LOCK_CLASS = 424_200_001;
/** Turns one call answers at most, when messages keep arriving. */
const MAX_PASSES = 3;

type Answered = Extract<IntakeTurnResponse, { message_id: string }>;

/**
 * Under this there is no point starting a cleanup round trip: it can't finish,
 * and a statement sent to a connection that may be gone only delays the
 * response further. Destroying the connection does the same job for free.
 */
const MIN_CLEANUP_MS = 25;

/** What is left of the call's budget, and what each step may therefore spend. */
export interface Budget {
  remainingMs(): number;
  /** What cleanup may spend: what's left, or nothing when that is too little to be worth sending. */
  cleanupMs(): number;
  /** The share held back for cleanup and the final write, so the model can't spend it. */
  readonly reserveMs: number;
}

/** Cleanup and the final write, when the caller doesn't say: a fifteenth of the turn, and never under 40 ms. */
const defaultReserve = (deadlineMs: number) => Math.max(40, Math.round(deadlineMs / 15));

function startBudget({ budgetMs, deadlineMs }: HandlerDeps): Budget {
  const started = Date.now();
  const total = budgetMs ?? deadlineMs + defaultReserve(deadlineMs);
  const remainingMs = () => total - (Date.now() - started);
  return {
    remainingMs,
    cleanupMs: () => (remainingMs() < MIN_CLEANUP_MS ? 0 : remainingMs()),
    reserveMs: Math.max(0, total - deadlineMs),
  };
}

const outOfBudget = (cause?: unknown) =>
  new DatabaseUnavailableError("the turn ran out of budget before it could answer; gateway retries this", { cause });

export async function handleTurn(deps: HandlerDeps, buildId: string, trace?: TraceContext): Promise<IntakeTurnResponse | null> {
  const budget = startBudget(deps);
  const client = await deps.pool.connect();
  // Every handle this turn opens on the connection, so the end of the call can
  // fence all of them: work left over from one must never reach the next
  // caller's connection.
  const handles: ClientDb[] = [];
  const open = () => {
    const handle = createClientDb(client);
    handles.push(handle);
    return handle;
  };
  const { db, client: fenced } = open();
  let broken: Error | undefined;
  try {
    // One race over the whole call, so a query with no budget left behind it —
    // a read, the lock, the unlock — ends the call instead of adding its own
    // timeout to a response the caller has stopped waiting for.
    return await withinBudget(answerWhileUnanswered(deps, budget, open, fenced, db, buildId, trace), budget);
  } catch (error) {
    broken ??= error as Error;
    throw error;
  } finally {
    // Fence every handle in one synchronous sweep before awaiting any of them:
    // work this call abandoned can still be running, and nothing it does from
    // here on may reach the wire. Then wait for the cleanups, in the budget
    // they have left between them.
    //
    // A connection that can't be left clean is destroyed, not returned — and
    // destroying it is also what releases the advisory lock, so a retry finds
    // the build free instead of a noop from a lock nobody is using.
    const cleanups = handles.map((handle) => handle.close({ withinMs: budget.cleanupMs() }));
    for (const cleanup of cleanups) {
      await cleanup.catch((error: Error) => {
        broken ??= error;
      });
    }
    client.release(broken);
  }
}

/** The lock-and-answer loop. Runs under the call's budget; anything it leaves behind is fenced by the caller. */
async function answerWhileUnanswered(
  deps: HandlerDeps,
  budget: Budget,
  open: () => ClientDb,
  client: pg.PoolClient,
  db: Db,
  buildId: string,
  trace?: TraceContext,
): Promise<IntakeTurnResponse | null> {
  const [build] = await db.select({ id: builds.id }).from(builds).where(eq(builds.id, buildId));
  if (!build) return null;

  let last: Answered | undefined;
  let passes = 0;
  while (passes < MAX_PASSES) {
    // Another pass means another model call: only with a turn's worth of budget for it.
    if (budget.remainingMs() <= budget.reserveMs) break;
    const { rows } = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1, hashtext($2)) AS locked", [TURN_LOCK_CLASS, buildId]);
    if (!rows[0]?.locked) break;
    let usable = true;
    try {
      while (passes < MAX_PASSES) {
        const answered = await answerLatest(deps, budget, open, db, buildId, trace);
        if (!answered) break;
        last = answered;
        passes++;
        if (budget.remainingMs() <= budget.reserveMs) break;
      }
    } catch (error) {
      // The turn only fails this way when the connection couldn't be cleaned
      // up or the budget ran out — either way it is about to be destroyed.
      usable = false;
      throw error;
    } finally {
      // Unlocking is worth a query on a healthy connection and nothing on a
      // dying one, where destroying it releases the lock anyway — and where
      // one more statement is one more wait the caller can't afford.
      if (usable && budget.cleanupMs() > 0) {
        await client.query("SELECT pg_advisory_unlock($1, hashtext($2))", [TURN_LOCK_CLASS, buildId]);
      }
    }
    if (!(await latestIsUnanswered(db, buildId))) break;
  }
  return last ?? { noop: true };
}

/**
 * What the budget has left, or `DatabaseUnavailableError` when it runs out
 * first. The work is abandoned, not cancelled — the caller destroys the
 * connection it was running on, which is what actually stops it.
 */
function withinBudget<T>(work: Promise<T>, budget: Budget): Promise<T> {
  const remaining = budget.remainingMs();
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(outOfBudget()), Math.max(0, remaining));
    timer.unref?.();
  });
  work.catch(() => undefined);
  return Promise.race([work, expired]).finally(() => clearTimeout(timer)) as Promise<T>;
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
async function answerLatest(
  deps: HandlerDeps,
  budget: Budget,
  open: () => ClientDb,
  db: Db,
  buildId: string,
  trace?: TraceContext,
): Promise<Answered | undefined> {
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
   * with Drizzle's own rollback fenced out so it can't race. All of that is
   * bounded by what the budget has left, because it runs on a connection that
   * may be exactly what stopped answering. If it can't be done in time the
   * close rejects, the connection is destroyed rather than reused, and the
   * turn ends as a 503 that gateway retries — no reply is written here, and no
   * half-written one is left behind.
   */
  const turnHandle = open();
  let outcome: TurnOutcome;
  try {
    // Whichever is sooner: the turn's own deadline, or what the budget can
    // spare once cleanup and the write are paid for.
    const deadlineMs = Math.min(deps.deadlineMs, budget.remainingMs() - budget.reserveMs);
    outcome = await withDeadline({ ...deps, deadlineMs }, buildId, trace, (signal) =>
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
    await turnHandle.close({ withinMs: budget.cleanupMs() });
  }

  const idleStatus = previous?.settled ? "planning" : "asking";
  const reply = outcome.kind === "spec" ? outcome.decision.reply : outcome.reply;
  const status = outcome.kind === "spec" ? outcome.decision.status : idleStatus;

  const write = db.transaction(async (tx) => {
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
  // The write is inside the budget too: it can block on the same row locks as
  // anything else. Giving up on it abandons a transaction, so the connection
  // is destroyed — the server rolls it back, and gateway's retry writes the
  // reply. If it had committed just as we gave up, the retry finds the message
  // answered and is a noop, so there is still exactly one.
  const written = await withinBudget(write, budget);

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
