import { ANON_OWNER_COOKIE, SESSION_COOKIE } from "@albusforge/schema";
import { RequestCookies, ResponseCookies } from "next/dist/compiled/@edge-runtime/cookies";
import { describe, expect, it } from "vitest";
import { credentialCookieHeader } from "./credential-cookies";
import { gatewayHeaders } from "./gateway-headers.server";

const store = (entries: Record<string, string>) => ({
  get: (name: string) => (name in entries ? { value: entries[name]! } : undefined),
});

describe("credentialCookieHeader", () => {
  it("forwards only the two allowlisted credentials", () => {
    expect(credentialCookieHeader(store({ [SESSION_COOKIE]: "s1", [ANON_OWNER_COOKIE]: "a1", tracker: "x", theme: "dark" }))).toBe(
      `${SESSION_COOKIE}=s1; ${ANON_OWNER_COOKIE}=a1`,
    );
  });

  it("drops deleted (empty) credentials, and is null with none", () => {
    expect(credentialCookieHeader(store({ [SESSION_COOKIE]: "", [ANON_OWNER_COOKIE]: "a1" }))).toBe(`${ANON_OWNER_COOKIE}=a1`);
    expect(credentialCookieHeader(store({ theme: "dark" }))).toBeNull();
  });

  it("reflects a session set after the request arrived — the verify roundtrip", () => {
    // What Next's action-phase cookie store does: the request's cookies, with the action's sets and deletes applied.
    const requestHeaders = new Headers({ cookie: `${ANON_OWNER_COOKIE}=a1; theme=dark` });
    const request = new RequestCookies(requestHeaders);
    const response = new ResponseCookies(new Headers());
    response.set(SESSION_COOKIE, "sess-new", { path: "/", secure: true, httpOnly: true });
    response.delete({ name: ANON_OWNER_COOKIE, path: "/", secure: true });
    const merged = {
      get: (name: string) => response.get(name) ?? request.get(name),
    };

    // The original header still has no session: forwarding it is the stale-header bug.
    expect(requestHeaders.get("cookie")).not.toContain(SESSION_COOKIE);
    const header = credentialCookieHeader(merged);
    expect(header).toBe(`${SESSION_COOKIE}=sess-new`);
    expect(gatewayHeaders({ host: "albusforge.ai", forwardedFor: null, cookie: header }, null, 1).cookie).toBe(`${SESSION_COOKIE}=sess-new`);
  });
});
