/*
 * The SSR contract's client IP (ADR 0007). Web's server-side calls carry
 * `X-Albus-Internal-Auth: Bearer <Google ID token>` for web's runtime service
 * account with gateway's URL as audience, plus `X-Albus-Client-IP`. Gateway
 * trusts the forwarded IP only when the token verifies; otherwise the visitor
 * is whoever the load balancer says sent the request.
 */
import { isIP } from "node:net";
import { OAuth2Client } from "google-auth-library";

export const INTERNAL_AUTH_HEADER = "x-albus-internal-auth";
export const CLIENT_IP_HEADER = "x-albus-client-ip";

export interface InternalAuthVerifier {
  /** True when the bearer token is a valid ID token for the SSR service account and gateway's audience. */
  verify(token: string): Promise<boolean>;
}

export interface GoogleInternalAuthOptions {
  /** Gateway's own URL, the token's `aud`. */
  audience: string;
  /** Web's runtime service account email, the token's `email`. */
  serviceAccount: string;
  client?: Pick<OAuth2Client, "verifyIdToken">;
  now?: () => number;
}

/** Verified tokens are remembered until they expire, so one ID token (web caches it for ~55 min) costs one signature check. */
const CACHE_MAX = 1000;

export function googleInternalAuthVerifier({ audience, serviceAccount, client = new OAuth2Client(), now = Date.now }: GoogleInternalAuthOptions): InternalAuthVerifier {
  const verified = new Map<string, number>();
  const expected = serviceAccount.toLowerCase();
  return {
    async verify(token) {
      const cachedExp = verified.get(token);
      if (cachedExp !== undefined) {
        if (cachedExp > now()) return true;
        verified.delete(token);
      }
      let payload;
      try {
        payload = (await client.verifyIdToken({ idToken: token, audience })).getPayload();
      } catch {
        return false;
      }
      if (!payload || payload.email_verified !== true || payload.email?.toLowerCase() !== expected) return false;
      if (verified.size >= CACHE_MAX) verified.clear();
      verified.set(token, payload.exp * 1000);
      return true;
    },
  };
}

/** Trusts nothing: for local runs and tests, and until INTERNAL_AUTH_AUDIENCE is set. */
export const untrustingVerifier: InternalAuthVerifier = { verify: async () => false };

type Headers = Readonly<Record<string, string | string[] | undefined>>;

function header(headers: Headers, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The visitor's IP from X-Forwarded-For. Proxies append, so only the right-hand
 * end is trustworthy: the external Application LB appends `<client-ip>, <lb-ip>`
 * after whatever the client sent, and Cloud Run adds nothing. Skip `trustedHops`
 * entries from the right and take the next one; with too few entries there is
 * no trustworthy IP.
 */
export function clientIpFromXff(value: string | undefined, trustedHops: number): string | undefined {
  if (!value) return undefined;
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const candidate = entries[entries.length - 1 - trustedHops];
  return candidate !== undefined && isIP(candidate) !== 0 ? candidate : undefined;
}

export interface ClientIpOptions {
  verifier: InternalAuthVerifier;
  /** Entries at the right end of X-Forwarded-For that belong to our own proxies. */
  trustedProxyHops: number;
}

export interface ClientIpRequest {
  headers: Headers;
  /** The socket's remote address, the fallback. */
  ip: string;
}

/**
 * The visitor's IP for rate limiting: the forwarded one on a verified internal
 * request, else the load balancer's view, else the socket address. Never
 * undefined, so every request lands in some bucket.
 */
export async function clientIp(request: ClientIpRequest, { verifier, trustedProxyHops }: ClientIpOptions): Promise<string> {
  const auth = header(request.headers, INTERNAL_AUTH_HEADER);
  const forwarded = header(request.headers, CLIENT_IP_HEADER);
  if (auth?.startsWith("Bearer ") && forwarded !== undefined && isIP(forwarded) !== 0 && (await verifier.verify(auth.slice("Bearer ".length).trim()))) {
    return forwarded;
  }
  return clientIpFromXff(header(request.headers, "x-forwarded-for"), trustedProxyHops) ?? request.ip;
}
