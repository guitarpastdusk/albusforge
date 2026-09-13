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
 * The visitor's IP from X-Forwarded-For.
 *
 * Proxies append, so only the right-hand end is trustworthy: the external
 * Application LB appends `<client-ip>, <lb-ip>` after whatever the client sent.
 * Skip `trustedHops` entries from the right (TRUSTED_PROXY_HOPS, default 1 —
 * the LB's own IP) and return the next one. With too few entries there is no
 * trustworthy client IP, so the result is undefined — never entry 0.
 */
export function clientIpFromXff(header: string | null | undefined, trustedHops: number): string | undefined {
  if (!Number.isInteger(trustedHops) || trustedHops < 0) {
    throw new RangeError(`trustedHops must be a non-negative integer, got ${trustedHops}`);
  }
  if (!header) return undefined;

  const entries = header
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const index = entries.length - 1 - trustedHops;
  return index >= 0 ? entries[index] : undefined;
}

export function gatewayHeaders(
  incoming: IncomingRequest,
  idToken: string | null,
  trustedProxyHops: number,
): Record<string, string> {
  const headers: Record<string, string> = {};

  if (idToken) headers[INTERNAL_AUTH_HEADER] = `Bearer ${idToken}`;
  if (incoming.host) headers[ORIGINAL_HOST_HEADER] = incoming.host;

  const ip = clientIpFromXff(incoming.forwardedFor, trustedProxyHops);
  if (ip) headers[CLIENT_IP_HEADER] = ip;

  const cookies = forwardedCookies(incoming.cookie);
  if (cookies) headers.cookie = cookies;

  return headers;
}
