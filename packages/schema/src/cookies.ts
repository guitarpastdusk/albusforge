/**
 * Cookie names shared by gateway (which sets them) and the portal (whose SSR
 * forwards them). `__Host-` forces Secure, Path=/ and no Domain attribute, so
 * each cookie stays on the host that set it (ADR 0007).
 */

/** The signed-in session. */
export const SESSION_COOKIE = "__Host-albus_session";

/** Owns anonymous builds, so /build/[buildId] renders server-side before sign-up. */
export const ANON_OWNER_COOKIE = "__Host-albus_anon";

/** The only cookies SSR forwards to gateway. Everything else is dropped. */
export const FORWARDED_COOKIES = [SESSION_COOKIE, ANON_OWNER_COOKIE] as const;
