/*
 * Server runtime configuration, validated once at startup (instrumentation.ts)
 * and again wherever it is read. Pure: takes the environment as an argument.
 */

export type ApiMode = "mock" | "live";

export interface RuntimeConfig {
  apiMode: ApiMode;
  /** Proxies that append to X-Forwarded-For after the client: the LB's own entry by default. */
  trustedProxyHops: number;
}

type Env = Record<string, string | undefined>;

/** Unset means `live`. Local dev opts into mock through .env.development. */
export function parseApiMode(raw: string | undefined): ApiMode {
  if (raw === undefined || raw === "") return "live";
  if (raw === "mock" || raw === "live") return raw;
  throw new Error(`API_MODE must be "mock" or "live", got "${raw}"`);
}

export function parseTrustedProxyHops(raw: string | undefined): number {
  if (raw === undefined || raw === "") return 1;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`TRUSTED_PROXY_HOPS must be a non-negative integer, got "${raw}"`);
  }
  return Number(raw);
}

/**
 * Throws on invalid values, and refuses mock data on Cloud Run: K_SERVICE is
 * always set there, and a deployed portal serving fixtures would look healthy
 * while showing every visitor fake devices.
 */
export function loadRuntimeConfig(env: Env): RuntimeConfig {
  const apiMode = parseApiMode(env.API_MODE);
  const trustedProxyHops = parseTrustedProxyHops(env.TRUSTED_PROXY_HOPS);

  if (apiMode === "mock" && env.K_SERVICE) {
    throw new Error(
      `API_MODE=mock is not allowed on Cloud Run (K_SERVICE="${env.K_SERVICE}"). ` +
        `Unset API_MODE or set it to "live".`,
    );
  }

  return { apiMode, trustedProxyHops };
}
