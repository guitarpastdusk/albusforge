import type { ReactNode } from "react";

/*
 * Signed-in screens: projects, live systems, device dashboards, usage.
 *
 * TODO(auth): session guard. Call GET /v1/me through lib/api/server; on 401,
 * redirect("/signin?next=<path>"). The session cookie (`__Host-albus_session`)
 * is host-only by construction — no Domain attribute — so signing in on a tenant
 * subdomain needs a redirect handoff, not a parent-domain cookie (ADR 0007).
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return children;
}
