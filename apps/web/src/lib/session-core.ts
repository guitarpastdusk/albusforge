import type { Me } from "@albusforge/schema";
import { ApiRequestError } from "./api/core";
import type { ApiMode } from "./runtime-config";

export interface SessionSources {
  /** The `__Host-albus_session` cookie's value, if the browser sent one. */
  cookieValue: string | undefined;
  apiMode: ApiMode;
  /** GET /v1/me, forwarding the session cookie. */
  fetchMe: () => Promise<Me>;
  /** Mock mode: whether the mock issued this cookie, and whose session it is. */
  mockSession: (cookieValue: string) => Me | null | Promise<Me | null>;
}

/**
 * Who is signed in, or null. Pure (lib/session.ts wires it to Next).
 *
 * - No session cookie: logged out, without asking gateway — so public pages
 *   still render for anonymous visitors while gateway is down.
 * - Live: GET /v1/me. A 401 means logged out. Anything else (5xx, HTML from a
 *   placeholder, a schema mismatch) is thrown, so it reaches the error
 *   boundary instead of silently looking logged out.
 * - Mock: the cookie must be one the mock's verify issued.
 */
export async function resolveSession({ cookieValue, apiMode, fetchMe, mockSession }: SessionSources): Promise<Me | null> {
  if (!cookieValue) return null;
  if (apiMode === "mock") return mockSession(cookieValue);
  try {
    return await fetchMe();
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) return null;
    throw error;
  }
}
