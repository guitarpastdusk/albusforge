import { SESSION_COOKIE } from "@albusforge/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, GatewayError } from "./api/core";

const jar = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined) }),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  }),
}));
vi.mock("./api/server", () => ({ apiGet: vi.fn() }));

const { redirect } = await import("next/navigation");
const { apiGet } = await import("./api/server");
const { getSession, requireSession } = await import("./session");
const { mockSessionCookie } = await import("@/mocks");

const ME = {
  user: { id: "usr_1", email: "you@example.com", display_name: null },
  tenant: { id: "ten_1", name: "Personal", slug: null, role: "admin" as const },
  tenants: [{ id: "ten_1", name: "Personal", slug: null, role: "admin" as const }],
};

const redirectedTo = async (call: Promise<unknown>) => ((await call.catch((error: unknown) => error)) as { url?: string }).url;

beforeEach(() => {
  jar.clear();
  vi.mocked(apiGet).mockReset();
  vi.mocked(redirect).mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("live mode", () => {
  beforeEach(() => {
    vi.stubEnv("API_MODE", "live");
  });

  it("no session cookie: logged out without calling gateway, and the guard redirects with next", async () => {
    await expect(getSession()).resolves.toBeNull();
    expect(await redirectedTo(requireSession("/live/bed-a"))).toBe("/signin?next=%2Flive%2Fbed-a");
    expect(apiGet).not.toHaveBeenCalled();
  });

  it("GET /v1/me with the session cookie: the signed-in user", async () => {
    jar.set(SESSION_COOKIE, "sess-1");
    vi.mocked(apiGet).mockResolvedValue(ME);
    await expect(requireSession("/projects")).resolves.toEqual(ME);
    expect(apiGet).toHaveBeenCalledWith("/v1/me", expect.anything());
    expect(redirect).not.toHaveBeenCalled();
  });

  it("a 401 from /v1/me means logged out: redirect to sign in", async () => {
    jar.set(SESSION_COOKIE, "expired");
    vi.mocked(apiGet).mockRejectedValue(new ApiRequestError(401, "unauthorized", "session expired"));
    await expect(getSession()).resolves.toBeNull();
    expect(await redirectedTo(requireSession("/projects"))).toBe("/signin?next=%2Fprojects");
  });

  it.each([
    ["a 503", new ApiRequestError(503, "unavailable", "try later")],
    ["a 403", new ApiRequestError(403, "forbidden", "no")],
    ["an HTML placeholder", new GatewayError({ route: "GET /v1/me", status: 200, contentType: "text/html", reason: "not_json" })],
  ])("%s from /v1/me reaches the error boundary: thrown, not treated as logged out", async (_label, failure) => {
    jar.set(SESSION_COOKIE, "sess-1");
    vi.mocked(apiGet).mockRejectedValue(failure);
    await expect(requireSession("/projects")).rejects.toBe(failure);
    await expect(getSession()).rejects.toBe(failure);
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("mock mode", () => {
  beforeEach(() => {
    vi.stubEnv("API_MODE", "mock");
  });

  it("a cookie the mock verify issued is a session for that email", async () => {
    jar.set(SESSION_COOKIE, mockSessionCookie("sam@example.org"));
    const session = await requireSession("/live");
    expect(session.user.email).toBe("sam@example.org");
    expect(apiGet).not.toHaveBeenCalled();
  });

  it.each(["mock-session", "junk", "mock-session.bm90LWFuLWVtYWls"])("a cookie the mock didn't issue (%s) is logged out", async (value) => {
    jar.set(SESSION_COOKIE, value);
    await expect(getSession()).resolves.toBeNull();
    expect(await redirectedTo(requireSession("/projects/greenhouse-soil"))).toBe("/signin?next=%2Fprojects%2Fgreenhouse-soil");
  });
});
