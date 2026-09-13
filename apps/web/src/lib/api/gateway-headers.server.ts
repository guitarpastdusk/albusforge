/*
 * Headers server-side rendering sends to gateway (ADR 0007, PORTAL.md §1).
 * Imported only by server.ts, which is guarded by `server-only`. The browser
 * never sets any of these.
 */

import { FORWARDED_COOKIES } from "@albusforge/schema";

export const INTERNAL_AUTH_HEADER = "x-albus-internal-auth";
export const ORIGINAL_HOST_HEADER = "x-albus-original-host";
export const CLIENT_IP_HEADER = "x-albus-client-ip";

export interface IncomingRequest {
  host: string | null;
  forwardedFor: string | null;
  cookie: string | null;
}

/**
 * A Cookie header holding only the allowlisted cookies (session, anonymous
 * owner), in allowlist order — or null if neither is present. The full
 * incoming Cookie header is never forwarded.
 */
export function forwardedCookies(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;

  const found = new Map<string, string>();
  for (const pair of cookieHeader.split(";")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (value && (FORWARDED_COOKIES as readonly string[]).includes(name) && !found.has(name)) {
      found.set(name, value);
    }
  }

  const kept = FORWARDED_COOKIES.flatMap((name) => {
    const value = found.get(name);
    return value ? [`${name}=${value}`] : [];
  });
  return kept.length ? kept.join("; ") : null;
}

/**
 * The visitor's IP as the Google load balancer saw it.
 *
 * The external Application LB *appends* `<client-ip>, <lb-ip>` to whatever
 * X-Forwarded-For the client sent, so the first entry is client-controlled
 * and spoofable. The LB-observed client is the second-to-last entry.
 */
export function clientIp(forwardedFor: string | null): string | null {
  if (!forwardedFor) return null;
  const hops = forwardedFor
    .split(",")
    .map((hop) => hop.trim())
    .filter(Boolean);
  if (hops.length === 0) return null;
  // One entry means no LB appended anything (local dev); take it as-is.
  return hops.length === 1 ? (hops[0] ?? null) : (hops[hops.length - 2] ?? null);
}

export function gatewayHeaders(incoming: IncomingRequest, idToken: string | null): Record<string, string> {
  const headers: Record<string, string> = {};

  if (idToken) headers[INTERNAL_AUTH_HEADER] = `Bearer ${idToken}`;
  if (incoming.host) headers[ORIGINAL_HOST_HEADER] = incoming.host;

  const ip = clientIp(incoming.forwardedFor);
  if (ip) headers[CLIENT_IP_HEADER] = ip;

  const cookies = forwardedCookies(incoming.cookie);
  if (cookies) headers.cookie = cookies;

  return headers;
}
