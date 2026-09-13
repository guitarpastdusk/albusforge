import { getHeaderSession } from "@/lib/session";
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
  return <Header user={session ? { email: session.user.email, displayName: session.user.display_name } : null} />;
}
