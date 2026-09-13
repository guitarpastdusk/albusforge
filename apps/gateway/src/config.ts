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

export interface IntakeConfig {
  /** Intake's run.app URL, the ID token audience. Null when unset: turns are skipped with a WARNING. */
  url: string | null;
  /** `google`: an ID token from the metadata server. `none`: no Authorization header (local, tests). */
  auth: "google" | "none";
}

export interface GatewayConfig {
  port: number;
  db: DbConfig;
  dbTimeouts: DbTimeouts;
  intake: IntakeConfig;
  /** Candidate parts include draft parts as well as active ones. */
  registryIncludeDrafts: boolean;
  /** Builds created without a valid anonymous owner cookie, per instance per sliding hour. */
  anonBuildsPerHour: number;
}

const Millis = z.coerce.number().int().min(1).max(600_000);

const ServerEnv = z.object({
  // Cloud Run sets PORT.
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  DB_CONNECT_TIMEOUT_MS: Millis.default(5000),
  DB_QUERY_TIMEOUT_MS: Millis.default(10_000),
  DB_IDLE_TIMEOUT_MS: Millis.default(30_000),
  INTAKE_URL: z.url({ protocol: /^https?$/ }).optional(),
  INTAKE_AUTH: z.enum(["google", "none"]).default("google"),
  REGISTRY_INCLUDE_DRAFTS: z.enum(["true", "false"]).default("false"),
  ANON_BUILDS_PER_HOUR: z.coerce.number().int().min(1).max(1_000_000).default(60),
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
  // An empty variable reads as unset.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ""));
  const parsed = ServerEnv.safeParse(cleaned);
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
    intake: { url: e.INTAKE_URL ?? null, auth: e.INTAKE_AUTH },
    registryIncludeDrafts: e.REGISTRY_INCLUDE_DRAFTS === "true",
    anonBuildsPerHour: e.ANON_BUILDS_PER_HOUR,
  };
}
