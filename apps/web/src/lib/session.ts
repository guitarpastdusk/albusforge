import "server-only";
import { Me, routes, SESSION_COOKIE } from "@albusforge/schema";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { apiGet } from "./api/server";
import { signinHref } from "./next-path";
import { loadRuntimeConfig } from "./runtime-config";
import { resolveSession } from "./session-core";

/**
 * The session for this request, or null — the data access layer for auth
 * (Next's authentication guide). Memoized per request with React `cache`, so
 * the header and the page share one GET /v1/me.
 */
export const getSession = cache(async (): Promise<Me | null> => {
  const cookieValue = (await cookies()).get(SESSION_COOKIE)?.value;
  return resolveSession({
    cookieValue,
    apiMode: loadRuntimeConfig(process.env).apiMode,
    fetchMe: () => apiGet(routes.me.get.path(), Me),
    mockSession: async (value) => (await import("@/mocks")).mockSession(value),
  });
});

/**
 * Every signed-in page calls this first, with its own path. Logged out →
 * /signin?next=<path>. A gateway failure throws to the error boundary.
 * The check runs in the page, next to its data, not in the (app) layout:
 * layouts don't re-render on navigation and don't stop their pages rendering.
 */
export async function requireSession(path: string): Promise<Me> {
  const session = await getSession();
  if (!session) redirect(signinHref(path));
  return session;
}
