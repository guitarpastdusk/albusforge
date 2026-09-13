import { createDb } from "@albusforge/db";
import type { Config } from "./config.js";

/** Standard PostgreSQL locally and over private VPC networking in production. */
export function connectDatabase(config: Config) {
  const { pool } = createDb(config.db, { max: config.poolOptions.max,
    connectTimeoutMs: config.poolOptions.connectionTimeoutMillis,
    statementTimeoutMs: config.poolOptions.statement_timeout,
    queryTimeoutMs: config.poolOptions.query_timeout,
    idleTimeoutMs: config.poolOptions.idleTimeoutMillis });
  return { pool, close: () => pool.end() };
}
