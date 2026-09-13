import { describe, expect, it, vi } from "vitest";
import { ResponseCookies } from "next/dist/compiled/@edge-runtime/cookies";
import { applyRelays, mergeCookieHeader, nextCookieWriter, parseSetCookie, relayableCookies } from "./cookies";

const NOW = new Date("2026-09-13T12:00:00Z");

describe("parseSetCookie", () => {
  it("reads the value and attributes", () => {
    expect(
      parseSetCookie("__Host-albus_session=abc.def; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000; Domain=albusforge.ai"),
    ).toEqual({
      name: "__Host-albus_session",
      value: "abc.def",
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "lax",
      maxAge: 2592000,
      domain: "albusforge.ai",
    });
  });

  it("rejects a line without a name", () => {
    expect(parseSetCookie("=oops; Path=/")).toBeNull();
    expect(parseSetCookie("garbage")).toBeNull();
  });
});

describe("relayableCookies", () => {
  it("relays only the two credential cookies, host-only with Secure and Path=/", () => {
    const relays = relayableCookies(
      [
        "__Host-albus_anon=anon-1; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=60",
        "tracker=abc; Path=/; Max-Age=60",
        "__Host-albus_session_old=x; Path=/; Secure",
        "albus_session=y; Path=/",
      ],
      NOW,
    );
    expect(relays).toEqual([
      { kind: "set", name: "__Host-albus_anon", value: "anon-1", options: { path: "/", secure: true, httpOnly: true, sameSite: "strict", maxAge: 60 } },
    ]);
  });

  it("drops a Domain and forces Secure and Path=/ even if gateway omitted them", () => {
    expect(relayableCookies(["__Host-albus_session=s; Domain=albusforge.ai; Path=/app; HttpOnly"], NOW)).toEqual([
      { kind: "set", name: "__Host-albus_session", value: "s", options: { path: "/", secure: true, httpOnly: true } },
    ]);
  });

  it("deletes on Max-Age=0, a past Expires, or an empty value", () => {
    expect(relayableCookies(["__Host-albus_anon=anon-1; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0"], NOW)).toEqual([
      { kind: "delete", name: "__Host-albus_anon", options: { path: "/", secure: true, httpOnly: true, sameSite: "lax" } },
    ]);
    expect(relayableCookies(["__Host-albus_anon=anon-1; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT"], NOW)).toEqual([
      { kind: "delete", name: "__Host-albus_anon", options: { path: "/", secure: true, httpOnly: false } },
    ]);
    expect(relayableCookies(["__Host-albus_session=; Path=/; Secure"], NOW)).toEqual([
      { kind: "delete", name: "__Host-albus_session", options: { path: "/", secure: true, httpOnly: false } },
    ]);
  });

  it("keeps a future Expires, and lets Max-Age win over Expires", () => {
    const future = "Fri, 13 Sep 2030 12:00:00 GMT";
    expect(relayableCookies([`__Host-albus_session=s; Secure; Expires=${future}`], NOW)).toEqual([
      { kind: "set", name: "__Host-albus_session", value: "s", options: { path: "/", secure: true, httpOnly: false, expires: new Date(future) } },
    ]);
    expect(relayableCookies(["__Host-albus_session=s; Max-Age=0; Expires=Fri, 13 Sep 2030 12:00:00 GMT"], NOW)).toEqual([
      { kind: "delete", name: "__Host-albus_session", options: { path: "/", secure: true, httpOnly: false } },
    ]);
  });

  it("lets the last line for a name win", () => {
    expect(relayableCookies(["__Host-albus_anon=a; Max-Age=60", "__Host-albus_anon=; Max-Age=0"], NOW)).toEqual([
      { kind: "delete", name: "__Host-albus_anon", options: { path: "/", secure: true, httpOnly: false } },
    ]);
  });
});

describe("applyRelays and mergeCookieHeader", () => {
  const relays = relayableCookies(
    ["__Host-albus_session=new; Secure; HttpOnly; Max-Age=60", "__Host-albus_anon=; Max-Age=0"],
    NOW,
  );

  it("sets and deletes through the writer", () => {
    const writer = { set: vi.fn(), delete: vi.fn() };
    applyRelays(relays, writer);
    expect(writer.set).toHaveBeenCalledWith("__Host-albus_session", "new", { path: "/", secure: true, httpOnly: true, maxAge: 60 });
    expect(writer.delete).toHaveBeenCalledWith("__Host-albus_anon", { path: "/", secure: true, httpOnly: false });
  });

  it("through Next's cookie store, a delete still carries Secure and Path=/ (browsers ignore a __Host- delete without them)", () => {
    const headers = new Headers();
    const store = new ResponseCookies(headers);
    applyRelays(
      relayableCookies(["__Host-albus_session=s1; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=60", "__Host-albus_anon=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0"], NOW),
      nextCookieWriter(store),
    );
    const lines = headers.getSetCookie();
    const anon = lines.find((line) => line.startsWith("__Host-albus_anon="));
    expect(anon).toMatch(/^__Host-albus_anon=;/);
    expect(anon).toMatch(/Path=\//);
    expect(anon).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(anon).toMatch(/Secure/);
    expect(anon).toMatch(/HttpOnly/);
    expect(anon).not.toMatch(/Domain/i);
    const session = lines.find((line) => line.startsWith("__Host-albus_session="));
    expect(session).toMatch(/Path=\/.*Max-Age=60.*Secure.*HttpOnly.*SameSite=lax/);
  });

  it("updates the Cookie header for follow-up calls", () => {
    expect(mergeCookieHeader("theme=dark; __Host-albus_anon=anon-1; __Host-albus_session=old", relays)).toBe(
      "theme=dark; __Host-albus_session=new",
    );
    expect(mergeCookieHeader(null, relayableCookies(["__Host-albus_anon=anon-1; Max-Age=60"], NOW))).toBe("__Host-albus_anon=anon-1");
    expect(mergeCookieHeader("__Host-albus_anon=a", relayableCookies(["__Host-albus_anon=; Max-Age=0"], NOW))).toBeNull();
  });
});
