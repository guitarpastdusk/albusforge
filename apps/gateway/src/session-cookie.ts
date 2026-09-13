/*
 * Session tokens and the two credential cookies (ADR 0008, PORTAL.md §5).
 *
 * A session token is 32 random bytes as base64url; only its SHA-256 is
 * stored (`users.sessions.token_hash`). Both cookies are `__Host-` cookies, so
 * browsers refuse them unless they are Secure, Path=/ and carry no Domain.
 */
import { createHash, randomBytes } from "node:crypto";
import { ANON_OWNER_COOKIE, SESSION_COOKIE } from "@albusforge/schema";

/** 30 days. */
export const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;

const COOKIE_ATTRIBUTES = "Path=/; Secure; HttpOnly; SameSite=Lax";

/** 32 bytes as unpadded base64url. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** The named cookie's value from a Cookie header, or undefined. First occurrence wins. */
export function cookieValue(header: string | string[] | undefined, name: string): string | undefined {
  const raw = Array.isArray(header) ? header.join("; ") : header;
  if (!raw) return undefined;
  for (const pair of raw.split(";")) {
    const index = pair.indexOf("=");
    if (index < 0) continue;
    if (pair.slice(0, index).trim() !== name) continue;
    return pair.slice(index + 1).trim();
  }
  return undefined;
}

/** The session cookie's token when present and well formed; otherwise undefined. */
export function sessionTokenFromCookieHeader(header: string | string[] | undefined): string | undefined {
  const value = cookieValue(header, SESSION_COOKIE);
  return value !== undefined && TOKEN_PATTERN.test(value) ? value : undefined;
}

export function sessionSetCookie(token: string, maxAgeS: number = SESSION_MAX_AGE_S): string {
  return `${SESSION_COOKIE}=${token}; ${COOKIE_ATTRIBUTES}; Max-Age=${maxAgeS}`;
}

/** Deletes the session cookie: an empty value with Max-Age=0, which web relays as a delete. */
export function sessionClearCookie(): string {
  return `${SESSION_COOKIE}=; ${COOKIE_ATTRIBUTES}; Max-Age=0`;
}

/** Deletes the anonymous owner cookie after verify has claimed its builds. */
export function anonOwnerClearCookie(): string {
  return `${ANON_OWNER_COOKIE}=; ${COOKIE_ATTRIBUTES}; Max-Age=0`;
}
