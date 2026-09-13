import { type DbConfig, dbConfigFromEnv } from "@albusforge/db";
import { z } from "zod";

export interface DbTimeouts {
  /** Connecting a client, or waiting for a free one. */
  connectMs: number;
  /** Server-side statement_timeout. */
  queryMs: number;
  /** Client-side read timeout: queryMs plus a margin, so the server's cancel normally wins. */
  readMs: number;
  /** An idle pooled client is closed after this long. */
  idleMs: number;
}

export interface GatewayConfig {
  port: number;
  db: DbConfig;
  dbTimeouts: DbTimeouts;
}

const Millis = z.coerce.number().int().min(1).max(600_000);

const ServerEnv = z.object({
  // Cloud Run sets PORT.
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  DB_CONNECT_TIMEOUT_MS: Millis.default(5000),
  DB_QUERY_TIMEOUT_MS: Millis.default(10_000),
  DB_IDLE_TIMEOUT_MS: Millis.default(30_000),
});

/** Added to DB_QUERY_TIMEOUT_MS for the client-side read timeout. */
export const READ_TIMEOUT_MARGIN_MS = 1000;

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Throws on invalid config, naming the variables but never echoing a value.
 * The database variables are required even though /healthz needs none of
 * them: a gateway deployed without them should fail at startup, not at the
 * first request.
 */
export function configFromEnv(env: Env = process.env): GatewayConfig {
  const parsed = ServerEnv.safeParse(env);
  if (!parsed.success) throw new Error(`Invalid gateway environment:\n${z.prettifyError(parsed.error)}`);
  const e = parsed.data;
  return {
    port: e.PORT,
    db: dbConfigFromEnv(env),
    dbTimeouts: {
      connectMs: e.DB_CONNECT_TIMEOUT_MS,
      queryMs: e.DB_QUERY_TIMEOUT_MS,
      readMs: e.DB_QUERY_TIMEOUT_MS + READ_TIMEOUT_MARGIN_MS,
      idleMs: e.DB_IDLE_TIMEOUT_MS,
    },
  };
}
