/*
 * The anonymous owner cookie (PORTAL.md §5, ADR 0008): a random 32-byte token
 * in `__Host-albus_anon`, whose SHA-256 is stored on each build it creates as
 * `builds.anon_owner_hash`. The token itself is never stored or logged.
 */
import { createHash, randomBytes } from "node:crypto";
import { ANON_OWNER_COOKIE } from "@albusforge/schema";

/** 30 days, the same as the unclaimed-build expiry. */
export const ANON_COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60;

/** 32 bytes as unpadded base64url. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function newAnonToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashAnonToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** The cookie's value when present and well formed; otherwise undefined. */
export function anonTokenFromCookieHeader(header: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(header) ? header.join("; ") : header;
  if (!raw) return undefined;
  for (const pair of raw.split(";")) {
    const index = pair.indexOf("=");
    if (index < 0) continue;
    if (pair.slice(0, index).trim() !== ANON_OWNER_COOKIE) continue;
    const value = pair.slice(index + 1).trim();
    if (TOKEN_PATTERN.test(value)) return value;
  }
  return undefined;
}

/** `__Host-` requires Secure, Path=/ and no Domain. */
export function anonOwnerSetCookie(token: string): string {
  return `${ANON_OWNER_COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${ANON_COOKIE_MAX_AGE_S}`;
}
