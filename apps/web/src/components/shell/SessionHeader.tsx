import { headers } from "next/headers";
import { getHeaderSession } from "@/lib/session";
import { WorkspaceIdentity } from "./WorkspaceIdentity";
import { Header } from "./Header";

/**
 * The header with the signed-in user. A Server Component rendered inside
 * <Suspense> in the root layout, so reading the session doesn't hold back the
 * page. If gateway fails, the header shows signed out and the failure is
 * logged once (`getHeaderSession`); public pages keep rendering. Guarded
 * pages check the session themselves and reach the error boundary.
 */
export async function SessionHeader() {
  const session = await getHeaderSession();
  const host = ((await headers()).get("host") ?? "").toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  const hostScoped = host.endsWith(".albusforge.ai") && host !== "staging.albusforge.ai";
  const workspace = session ? (hostScoped ? session.tenants.find((tenant) => tenant.slug === host.slice(0, -".albusforge.ai".length)) : session.tenant) : undefined;
  return <><WorkspaceIdentity intendedTenantId={workspace?.id ?? null} snapshot={session ? { userId: session.user.id, tenantId: session.tenant.id } : null} /><Header user={session ? { email: session.user.email, displayName: session.user.display_name,
    workspace, memberships: session.tenants, hostScoped } : null} /></>;
}
