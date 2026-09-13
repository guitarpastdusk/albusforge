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
