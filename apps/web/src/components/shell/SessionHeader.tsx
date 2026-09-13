import { getSession } from "@/lib/session";
import { Header } from "./Header";

/**
 * The header with the signed-in user. A Server Component rendered inside
 * <Suspense> in the root layout, so reading the session doesn't hold back the
 * page. If gateway fails, the error propagates to the error boundary rather
 * than the header quietly showing a logged-out state.
 */
export async function SessionHeader() {
  const session = await getSession();
  return <Header user={session ? { email: session.user.email, displayName: session.user.display_name } : null} />;
}
