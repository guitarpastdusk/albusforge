import type { ReactNode } from "react";
import { getSession } from "@/lib/session";
import { WorkspaceAdmission } from "@/components/shell/WorkspaceAdmission";

/*
 * Signed-in screens: projects, live systems, device dashboards, usage.
 *
 * The session guard is not here. Per Next's authentication guide, a layout
 * doesn't re-render on navigation and doesn't stop its pages from rendering,
 * so it can't be the check. Instead:
 *   - proxy.ts redirects a request with no session cookie to /signin?next=…
 *     before anything renders (optimistic: cookie only);
 *   - every page here calls `requireSession(path)` (lib/session.ts) first,
 *     which asks GET /v1/me — a 401 redirects, other failures reach error.tsx.
 *
 * The session cookie (`__Host-albus_session`) is host-only by construction —
 * no Domain attribute — so signing in on a tenant subdomain needs a redirect
 * handoff, not a parent-domain cookie (ADR 0007).
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  // Presentation reconciliation only. Each page and mutation retains its own authorization.
  if (!session) return children;
  return <WorkspaceAdmission snapshot={{ userId: session.user.id, tenantId: session.tenant.id }}>{children}</WorkspaceAdmission>;
}
