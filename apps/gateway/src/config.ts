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

export interface AuthConfig {
  /** `resend`: send codes through Resend (RESEND_API_KEY required). `log`: write them to the log (local, tests). */
  emailAdapter: "resend" | "log";
  resendApiKey: string | null;
  /** The From mailbox for sign-in codes. */
  emailFrom: string;
  /**
   * Gateway's own URL, the `aud` of web's X-Albus-Internal-Auth ID token, with
   * the SSR service account it must be issued to. Null when INTERNAL_AUTH_AUDIENCE
   * is unset (Terraform sets SSR_SERVICE_ACCOUNT on its own today): the forwarded
   * client IP is never trusted and SSR requests rate-limit as web's own IP.
   */
  internalAuth: { audience: string; serviceAccount: string } | null;
  /** X-Forwarded-For entries at the right end that belong to our proxies. */
  trustedProxyHops: number;
  /** Sign-in code requests per email and per client IP, and verify attempts per IP, in a sliding 15 minutes. */
  codesPerEmail: number;
  codesPerIp: number;
  verifiesPerIp: number;
}

export interface GatewayConfig {
  port: number;
  db: DbConfig;
  dbTimeouts: DbTimeouts;
  intake: IntakeConfig;
  /** Candidate parts include draft parts as well as active ones. */
  registryIncludeDrafts: boolean;
  /** Builds that create a new anonymous owner, per instance per sliding hour. */
  anonBuildsPerHour: number;
  /** Open event streams per anonymous owner and per instance. */
  sseStreamLimits: { perOwner: number; perInstance: number };
  auth: AuthConfig;
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
  SSE_MAX_STREAMS_PER_OWNER: z.coerce.number().int().min(1).max(1000).default(3),
  SSE_MAX_STREAMS: z.coerce.number().int().min(1).max(100_000).default(100),
  EMAIL_ADAPTER: z.enum(["resend", "log"]).default("resend"),
  RESEND_API_KEY: z.string().min(1).optional(),
  AUTH_EMAIL_FROM: z.string().min(3).default("Albusforge <sign-in@auth.albusforge.ai>"),
  INTERNAL_AUTH_AUDIENCE: z.url({ protocol: /^https$/ }).optional(),
  SSR_SERVICE_ACCOUNT: z.email().optional(),
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(1),
  AUTH_CODES_PER_EMAIL: z.coerce.number().int().min(1).max(10_000).default(5),
  AUTH_CODES_PER_IP: z.coerce.number().int().min(1).max(1_000_000).default(20),
  AUTH_VERIFIES_PER_IP: z.coerce.number().int().min(1).max(1_000_000).default(30),
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
  // The database variables are checked first, so a bare deploy names them before anything else.
  const db = dbConfigFromEnv(env);
  if (e.EMAIL_ADAPTER === "resend" && e.RESEND_API_KEY === undefined) {
    throw new Error("Invalid gateway environment:\nRESEND_API_KEY is required unless EMAIL_ADAPTER=log");
  }
  // The log adapter prints every code. Cloud Run sets K_SERVICE; refuse it there whatever the intent.
  if (e.EMAIL_ADAPTER === "log" && cleaned.K_SERVICE !== undefined) {
    throw new Error("Invalid gateway environment:\nEMAIL_ADAPTER=log is not allowed on Cloud Run (K_SERVICE is set)");
  }
  // An audience without the account it must belong to can verify nothing. The
  // reverse (account set, audience not) is today's Terraform and only disables the check.
  if (e.INTERNAL_AUTH_AUDIENCE !== undefined && e.SSR_SERVICE_ACCOUNT === undefined) {
    throw new Error("Invalid gateway environment:\nINTERNAL_AUTH_AUDIENCE requires SSR_SERVICE_ACCOUNT");
  }
  return {
    port: e.PORT,
    db,
    dbTimeouts: {
      connectMs: e.DB_CONNECT_TIMEOUT_MS,
      queryMs: e.DB_QUERY_TIMEOUT_MS,
      readMs: e.DB_QUERY_TIMEOUT_MS + READ_TIMEOUT_MARGIN_MS,
      idleMs: e.DB_IDLE_TIMEOUT_MS,
    },
    intake: { url: e.INTAKE_URL ?? null, auth: e.INTAKE_AUTH },
    registryIncludeDrafts: e.REGISTRY_INCLUDE_DRAFTS === "true",
    anonBuildsPerHour: e.ANON_BUILDS_PER_HOUR,
    sseStreamLimits: { perOwner: e.SSE_MAX_STREAMS_PER_OWNER, perInstance: e.SSE_MAX_STREAMS },
    auth: {
      emailAdapter: e.EMAIL_ADAPTER,
      resendApiKey: e.RESEND_API_KEY ?? null,
      emailFrom: e.AUTH_EMAIL_FROM,
      internalAuth:
        e.INTERNAL_AUTH_AUDIENCE === undefined || e.SSR_SERVICE_ACCOUNT === undefined
          ? null
          : { audience: e.INTERNAL_AUTH_AUDIENCE, serviceAccount: e.SSR_SERVICE_ACCOUNT },
      trustedProxyHops: e.TRUSTED_PROXY_HOPS,
      codesPerEmail: e.AUTH_CODES_PER_EMAIL,
      codesPerIp: e.AUTH_CODES_PER_IP,
      verifiesPerIp: e.AUTH_VERIFIES_PER_IP,
    },
  };
}
