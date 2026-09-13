import { type DbConfig, dbConfigFromEnv } from "@albusforge/db";
import { type Effort, LLM_PROVIDERS, type LlmProviderName } from "@albusforge/llm";
import { z } from "zod";
import { safeToLog } from "./log";

export interface DbTimeouts {
  connectMs: number;
  queryMs: number;
  readMs: number;
  idleMs: number;
}

export interface IntakeConfig {
  port: number;
  db: DbConfig;
  dbTimeouts: DbTimeouts;
  llm: {
    provider: LlmProviderName;
    model: string;
    effort: Effort;
    /** Never logged. */
    apiKey: string | undefined;
  };
  registryIncludeDrafts: boolean;
  buildTokenCeiling: number;
  turnDeadlineMs: number;
  /** The whole POST /v1/turns call: the turn deadline plus CLEANUP_RESERVE_MS. */
  turnBudgetMs: number;
}

export const READ_TIMEOUT_MARGIN_MS = 1000;

/**
 * Gateway's per-attempt deadline for `POST /v1/turns`
 * (`INTAKE_TIMEOUT_MS` in apps/gateway/src/intake.ts). Intake can't import it —
 * separate services — so it is pinned here and the two are checked at startup
 * against the same number. Gateway does not retry its own timeout, so an
 * answer that arrives after it is an answer nobody acts on.
 */
export const CALLER_ATTEMPT_BUDGET_MS = 50_000;
/** Time for the response to reach gateway: this is a deadline on our clock, not its. */
export const CALLER_MARGIN_MS = 1000;
/** Held back from the turn for cleanup and the final write (handler.ts). */
export const CLEANUP_RESERVE_MS = 3000;

const Millis = z.coerce.number().int().min(1).max(600_000);

const ServerEnv = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(8080),
    DB_CONNECT_TIMEOUT_MS: Millis.default(5000),
    DB_QUERY_TIMEOUT_MS: Millis.default(10_000),
    DB_IDLE_TIMEOUT_MS: Millis.default(30_000),
    LLM_PROVIDER: z.enum(LLM_PROVIDERS).default("anthropic"),
    LLM_MODEL: z.string().min(1),
    LLM_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("medium"),
    ANTHROPIC_API_KEY: z.string().optional(),
    REGISTRY_INCLUDE_DRAFTS: z.enum(["true", "false"]).default("false"),
    LLM_BUILD_TOKEN_CEILING: z.coerce.number().int().positive().default(300_000),
    // The model call, retries included (ASK-TO-ENCLOSURE.md §3).
    TURN_DEADLINE_MS: Millis.default(45_000),
  })
  .refine((e) => e.TURN_DEADLINE_MS + CLEANUP_RESERVE_MS <= CALLER_ATTEMPT_BUDGET_MS - CALLER_MARGIN_MS, {
    path: ["TURN_DEADLINE_MS"],
    message: `must leave room for cleanup inside gateway's ${CALLER_ATTEMPT_BUDGET_MS} ms attempt deadline: at most ${
      CALLER_ATTEMPT_BUDGET_MS - CALLER_MARGIN_MS - CLEANUP_RESERVE_MS
    } ms`,
  })
  .refine((e) => e.LLM_PROVIDER !== "anthropic" || (e.ANTHROPIC_API_KEY ?? "") !== "", {
    path: ["ANTHROPIC_API_KEY"],
    message: "required when LLM_PROVIDER=anthropic",
  });

type Env = Readonly<Record<string, string | undefined>>;

/** Throws on invalid config, naming variables but never echoing a value. */
export function configFromEnv(env: Env = process.env): IntakeConfig {
  const parsed = ServerEnv.safeParse(env);
  // Names variables and Zod's own messages, never a value: safe to log as-is.
  if (!parsed.success) throw safeToLog(new Error(`Invalid intake environment:\n${z.prettifyError(parsed.error)}`));
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
    llm: { provider: e.LLM_PROVIDER, model: e.LLM_MODEL, effort: e.LLM_EFFORT, apiKey: e.ANTHROPIC_API_KEY },
    registryIncludeDrafts: e.REGISTRY_INCLUDE_DRAFTS === "true",
    buildTokenCeiling: e.LLM_BUILD_TOKEN_CEILING,
    turnDeadlineMs: e.TURN_DEADLINE_MS,
    turnBudgetMs: e.TURN_DEADLINE_MS + CLEANUP_RESERVE_MS,
  };
}
