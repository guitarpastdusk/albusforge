import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { type DbConfig, pgConnectionConfig } from "./config.js";
import * as schema from "./schema/index.js";

export type Schema = typeof schema;
export type Db = NodePgDatabase<Schema>;

export interface CreateDbOptions {
  /** Pool size. Cloud SQL connection limits are per instance, so keep it small per Cloud Run instance. */
  max?: number;
  /**
   * How long to wait for a client: connecting a new one, or waiting for one
   * to free up when the pool is full. Unset waits forever.
   */
  connectTimeoutMs?: number;
  /** An idle client is closed after this long. pg's default is 10 s. */
  idleTimeoutMs?: number;
  /**
   * Server-side `statement_timeout`: Postgres cancels a statement that runs
   * longer (SQLSTATE 57014), including one stuck behind a lock. Unset is none.
   */
  statementTimeoutMs?: number;
  /**
   * Client-side `query_timeout`: gives up on a query whose response never
   * arrives, such as over a dead connection, where the server can't cancel
   * anything. Keep it above `statementTimeoutMs` so the server's cancel wins
   * when it can. Unset is none.
   *
   * pg-pool destroys a client whose query failed instead of returning it to the
   * pool, so a timed-out connection is never reused.
   */
  queryTimeoutMs?: number;
}

export const CLIENT_DB_CLOSED = "this database handle was closed with its connection";

export interface ClientDb {
  db: Db;
  /**
   * Ends the handle and leaves the connection usable again. It fences the
   * handle (no new queries), waits for the queries already in flight to
   * settle, and then rolls back, because a query abandoned mid-transaction —
   * or one that failed and left the transaction aborted — otherwise makes the
   * next `BEGIN` on this connection fail with 25P02.
   *
   * Rejects if the connection could not be brought back to a usable state, or
   * if the drain outran `drainMs`. Then it is not safe to reuse: hand the
   * error to `client.release(error)` so the pool destroys it.
   *
   * Safe to call more than once; later calls are the same cleanup again.
   */
  close(): Promise<void>;
}

export interface ClientDbOptions {
  /**
   * How long to wait for in-flight queries when closing. They are normally
   * bounded by the pool's `statementTimeoutMs`/`queryTimeoutMs`; this is the
   * backstop for a pool configured without them.
   */
  drainMs?: number;
}

/**
 * A typed Drizzle instance over one already checked-out connection.
 *
 * For work that holds a session-level resource on a connection — a
 * `pg_advisory_lock`, a temp table — and must not take a second connection
 * from the pool to run its queries: with a small pool, holders waiting on
 * queries and queries waiting on holders deadlock.
 *
 * The handle owns the connection's state between `createClientDb` and
 * `close()`. Call `close()` before `client.release()`, and before any other
 * handle uses the same connection, always.
 */
export function createClientDb(client: pg.PoolClient, { drainMs = 10_000 }: ClientDbOptions = {}): ClientDb {
  let closed = false;
  let issued = false;
  const inFlight = new Set<Promise<unknown>>();
  let cleanup: Promise<void> | undefined;

  const fenced = new Proxy(client, {
    get(target, property, receiver) {
      if (property === "query") {
        return (...args: unknown[]) => {
          if (closed) return Promise.reject(new Error(CLIENT_DB_CLOSED));
          issued = true;
          const result = (target.query as (...a: unknown[]) => unknown).apply(target, args);
          if (!isPromise(result)) return result;
          inFlight.add(result);
          const forget = () => void inFlight.delete(result);
          result.then(forget, forget);
          return result;
        };
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  async function drainAndRollback(): Promise<void> {
    // Settled, not successful: a query that failed still leaves the
    // transaction it was in aborted, which is exactly what needs rolling back.
    await deadline(Promise.allSettled([...inFlight]), drainMs, "the turn's queries did not finish in time");
    if (!issued) return;
    try {
      // Postgres only warns when there is no transaction to roll back, and it
      // is the one statement an aborted transaction still accepts. Issued on
      // the raw client: the fence is up, so nothing else can interleave.
      await client.query("ROLLBACK");
    } catch (error) {
      throw new Error("the database connection could not be rolled back", { cause: error });
    }
  }

  return {
    db: drizzle(fenced, { schema }),
    close() {
      closed = true;
      cleanup ??= drainAndRollback();
      return cleanup;
    },
  };
}

const isPromise = (value: unknown): value is Promise<unknown> => typeof (value as { then?: unknown } | null)?.then === "function";

function deadline<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

/** A typed Drizzle instance over its own pool. Call `pool.end()` on shutdown. */
export function createDb(config: DbConfig, options: CreateDbOptions = {}): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({
    ...pgConnectionConfig(config),
    max: options.max ?? 10,
    ...(options.connectTimeoutMs === undefined ? {} : { connectionTimeoutMillis: options.connectTimeoutMs }),
    ...(options.idleTimeoutMs === undefined ? {} : { idleTimeoutMillis: options.idleTimeoutMs }),
    ...(options.statementTimeoutMs === undefined ? {} : { statement_timeout: options.statementTimeoutMs }),
    ...(options.queryTimeoutMs === undefined ? {} : { query_timeout: options.queryTimeoutMs }),
  });
  const db = drizzle(pool, { schema });
  return { db, pool };
}
