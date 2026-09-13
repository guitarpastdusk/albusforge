import { type DbConfig, dbConfigFromEnv } from "@albusforge/db";
import { type Effort, LLM_PROVIDERS, type LlmProviderName } from "@albusforge/llm";
import { z } from "zod";

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
}

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
    // The whole turn, retries included (ASK-TO-ENCLOSURE.md §3).
    TURN_DEADLINE_MS: Millis.default(45_000),
  })
  .refine((e) => e.LLM_PROVIDER !== "anthropic" || (e.ANTHROPIC_API_KEY ?? "") !== "", {
    path: ["ANTHROPIC_API_KEY"],
    message: "required when LLM_PROVIDER=anthropic",
  });

export const READ_TIMEOUT_MARGIN_MS = 1000;

type Env = Readonly<Record<string, string | undefined>>;

/** Throws on invalid config, naming variables but never echoing a value. */
export function configFromEnv(env: Env = process.env): IntakeConfig {
  const parsed = ServerEnv.safeParse(env);
  if (!parsed.success) throw new Error(`Invalid intake environment:\n${z.prettifyError(parsed.error)}`);
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
  };
}
