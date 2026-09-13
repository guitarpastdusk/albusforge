import { SESSION_COOKIE } from "@albusforge/schema";
import { NextResponse, type NextRequest } from "next/server";
import { signinHref } from "@/lib/next-path";

/**
 * The optimistic half of the session guard (Next's authentication guide,
 * "Optimistic checks with Proxy"): before a signed-in route renders — or is
 * prefetched — a visitor with no session cookie goes to
 * /signin?next=<path>. It only reads the cookie; it never calls gateway.
 *
 * The real check is `requireSession()` (lib/session.ts), called by every
 * (app) page next to its data: a present but expired or forged cookie is
 * caught there, by GET /v1/me.
 */
export function proxy(request: NextRequest) {
  if (request.cookies.get(SESSION_COOKIE)?.value) return NextResponse.next();
  const { pathname, search } = request.nextUrl;
  return NextResponse.redirect(new URL(signinHref(`${pathname}${search}`), request.url));
}

/** The (app) route group: projects, live systems, usage — and everything under them. */
export const config = {
  matcher: ["/projects/:path*", "/live/:path*", "/usage/:path*"],
};
