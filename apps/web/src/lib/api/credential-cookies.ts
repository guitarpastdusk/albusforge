import { FORWARDED_COOKIES } from "@albusforge/schema";

/** The part of Next's `cookies()` store this reads. */
export interface CookieReader {
  get(name: string): { value: string } | undefined;
}

/**
 * The Cookie header gateway receives: only the allowlisted `__Host-`
 * credentials, read from Next's cookie store. Inside a Server Action that store
 * already reflects cookies the action set or deleted, so a render in the same
 * roundtrip (the header after verify) forwards the new session, not the
 * request's original Cookie header. A deleted cookie reads as empty and is
 * dropped. `gatewayHeaders` applies the same allowlist again.
 */
export function credentialCookieHeader(store: CookieReader): string | null {
  const pairs = FORWARDED_COOKIES.flatMap((name) => {
    const value = store.get(name)?.value;
    return value ? [`${name}=${value}`] : [];
  });
  return pairs.length > 0 ? pairs.join("; ") : null;
}
