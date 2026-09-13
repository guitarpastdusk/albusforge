import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { type DbConfig, pgConnectionConfig } from "./config.js";
import * as schema from "./schema/index.js";

export type Schema = typeof schema;
export type Db = NodePgDatabase<Schema>;

export interface CreateDbOptions {
  /** Pool size. Cloud SQL connection limits are per instance, so keep it small per Cloud Run instance. */
  max?: number;
}

/** A typed Drizzle instance over its own pool. Call `pool.end()` on shutdown. */
export function createDb(config: DbConfig, options: CreateDbOptions = {}): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({ ...pgConnectionConfig(config), max: options.max ?? 10 });
  const db = drizzle(pool, { schema });
  return { db, pool };
}
