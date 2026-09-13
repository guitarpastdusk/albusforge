import { Connector, IpAddressTypes } from "@google-cloud/cloud-sql-connector";
import { createDb } from "@albusforge/db";
import pg from "pg";
import type { Config } from "./config.js";

/** Hosting adapter only: ingest itself takes a standard pg.Pool. */
export async function connectDatabase(config: Config) {
  if (!config.instance) {
    if (!config.local) throw new Error("Missing local database configuration");
    const { pool } = createDb(config.local, { max: config.poolOptions.max,
      connectTimeoutMs: config.poolOptions.connectionTimeoutMillis,
      statementTimeoutMs: config.poolOptions.statement_timeout,
      queryTimeoutMs: config.poolOptions.query_timeout,
      idleTimeoutMs: config.poolOptions.idleTimeoutMillis });
    return { pool, close: () => pool.end() };
  }
  const connector = new Connector();
  try {
    const options = await connector.getOptions({ instanceConnectionName: config.instance, ipType: IpAddressTypes.PRIVATE });
    const pool = new pg.Pool({ ...options, ...config.poolOptions, user: config.user, password: config.password, database: config.database });
    return { pool, close: async () => { try { await pool.end(); } finally { connector.close(); } } };
  } catch (error) { connector.close(); throw error; }
}
