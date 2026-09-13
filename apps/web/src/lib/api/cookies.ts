import { FORWARDED_COOKIES } from "@albusforge/schema";

/*
 * Relaying gateway's credential cookies from a Server Function to the browser.
 * Pure: no Next.js imports, so it is tested directly.
 */

export type SameSite = "lax" | "strict" | "none";

export interface ParsedSetCookie {
  name: string;
  value: string;
  maxAge?: number;
  expires?: Date;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: SameSite;
  path?: string;
  domain?: string;
}

export function parseSetCookie(line: string): ParsedSetCookie | null {
  const [pair = "", ...attributes] = line.split(";");
  const eq = pair.indexOf("=");
  if (eq <= 0) return null;
  const name = pair.slice(0, eq).trim();
  if (!name) return null;

  const cookie: ParsedSetCookie = { name, value: pair.slice(eq + 1).trim(), httpOnly: false, secure: false };
  for (const attribute of attributes) {
    const [rawKey = "", ...rest] = attribute.split("=");
    const value = rest.join("=").trim();
    switch (rawKey.trim().toLowerCase()) {
      case "max-age":
        if (/^-?\d+$/.test(value)) cookie.maxAge = Number(value);
        break;
      case "expires": {
        const time = Date.parse(value);
        if (!Number.isNaN(time)) cookie.expires = new Date(time);
        break;
      }
      case "httponly":
        cookie.httpOnly = true;
        break;
      case "secure":
        cookie.secure = true;
        break;
      case "samesite": {
        const sameSite = value.toLowerCase();
        if (sameSite === "lax" || sameSite === "strict" || sameSite === "none") cookie.sameSite = sameSite;
        break;
      }
      case "path":
        cookie.path = value;
        break;
      case "domain":
        cookie.domain = value;
        break;
    }
  }
  return cookie;
}

/** Options for `cookies().set`: always host-only, `Path=/` and `Secure`, as the `__Host-` prefix requires. */
export interface RelayOptions {
  path: "/";
  secure: true;
  httpOnly: boolean;
  sameSite?: SameSite;
  maxAge?: number;
  expires?: Date;
}

/** Deleting a `__Host-` cookie needs `Secure` and `Path=/` too, or the browser ignores it. */
export type DeleteOptions = Omit<RelayOptions, "maxAge" | "expires">;

export type CookieRelay =
  | { kind: "set"; name: string; value: string; options: RelayOptions }
  | { kind: "delete"; name: string; options: DeleteOptions };

const ALLOWED: readonly string[] = FORWARDED_COOKIES;

/**
 * What to do with a response's Set-Cookie lines: set or delete the two
 * allowlisted credential cookies, ignore everything else. The last line for a
 * name wins. `Max-Age` takes precedence over `Expires` (RFC 6265 §5.3).
 * A domain is never relayed.
 */
export function relayableCookies(lines: readonly string[], now: Date = new Date()): CookieRelay[] {
  const relays = new Map<string, CookieRelay>();
  for (const line of lines) {
    const cookie = parseSetCookie(line);
    if (!cookie || !ALLOWED.includes(cookie.name)) continue;

    const expired =
      cookie.value === "" ||
      (cookie.maxAge !== undefined
        ? cookie.maxAge <= 0
        : cookie.expires !== undefined && cookie.expires.getTime() <= now.getTime());
    const options: RelayOptions = { path: "/", secure: true, httpOnly: cookie.httpOnly };
    if (cookie.sameSite) options.sameSite = cookie.sameSite;
    if (expired) {
      relays.set(cookie.name, { kind: "delete", name: cookie.name, options });
      continue;
    }

    if (cookie.maxAge !== undefined) options.maxAge = cookie.maxAge;
    else if (cookie.expires) options.expires = cookie.expires;
    relays.set(cookie.name, { kind: "set", name: cookie.name, value: cookie.value, options });
  }
  return [...relays.values()];
}

export interface CookieWriter {
  set(name: string, value: string, options: RelayOptions): void;
  delete(name: string, options: DeleteOptions): void;
}

export function applyRelays(relays: readonly CookieRelay[], writer: CookieWriter): void {
  for (const relay of relays) {
    if (relay.kind === "set") writer.set(relay.name, relay.value, relay.options);
    else writer.delete(relay.name, relay.options);
  }
}

/** The Cookie header for follow-up upstream calls in the same action, with the relayed credentials applied. */
export function mergeCookieHeader(header: string | null, relays: readonly CookieRelay[]): string | null {
  const pairs = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    pairs.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  }
  for (const relay of relays) {
    if (relay.kind === "set") pairs.set(relay.name, relay.value);
    else pairs.delete(relay.name);
  }
  return pairs.size > 0 ? [...pairs].map(([name, value]) => `${name}=${value}`).join("; ") : null;
}

/** The subset of Next's `cookies()` store the relay writes to. */
export interface CookieStore {
  set(name: string, value: string, options: RelayOptions): unknown;
  delete(options: DeleteOptions & { name: string }): unknown;
}

/**
 * Writes relays to Next's cookie store. Deletes pass the options object:
 * `delete(name)` alone emits no `Secure`, which browsers reject for `__Host-`.
 */
export function nextCookieWriter(store: CookieStore): CookieWriter {
  return {
    set: (name, value, options) => {
      store.set(name, value, options);
    },
    delete: (name, options) => {
      store.delete({ ...options, name });
    },
  };
}
