/*
 * Where to go after signing in. `next` arrives in a URL anyone can craft, so
 * only a same-origin relative path is ever followed. Pure: used by proxy.ts,
 * the session guard and the sign-in pages.
 */

export const DEFAULT_AFTER_SIGN_IN = "/projects";

const BASE = "http://albusforge.invalid";
const AUTH_PAGES = ["/signin", "/signup"];

/**
 * `raw` if it is a relative path on this origin (`/live/bed-a?range=24h`),
 * else null. Rejects `//evil`, `/\evil`, `https://evil`, `javascript:`,
 * control characters, and the sign-in pages themselves (no loops).
 */
export function safeNextPath(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 1000) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  // Browsers treat `\` as `/`, so `/\evil.com` is protocol-relative.
  if (raw.includes("\\") || [...raw].some((char) => char.charCodeAt(0) <= 0x20 || char.charCodeAt(0) === 0x7f)) return null;

  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE) return null;
  if (AUTH_PAGES.some((page) => url.pathname === page || url.pathname.startsWith(`${page}/`))) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** `/signin?next=%2Flive%2Fbed-a`, or the bare page when there is nowhere safe to return to. */
export function authHref(page: "/signin" | "/signup", next: string | null): string {
  const safe = safeNextPath(next);
  return safe ? `${page}?next=${encodeURIComponent(safe)}` : page;
}

/** Where the guard sends a logged-out visitor who asked for `path`. */
export const signinHref = (path: string): string => authHref("/signin", path);
