import { describe, expect, it } from "vitest";
import { anonOwnerClearCookie, cookieValue, hashSessionToken, newSessionToken, sessionClearCookie, sessionSetCookie, sessionTokenFromCookieHeader } from "./session-cookie";

describe("session tokens", () => {
  it("are 32 random bytes as base64url, hashed with SHA-256", () => {
    const token = newSessionToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newSessionToken()).not.toBe(token);
    expect(hashSessionToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
  });
});

describe("cookies", () => {
  const token = newSessionToken();

  it("reads the session cookie among others, first occurrence first", () => {
    expect(sessionTokenFromCookieHeader(`__Host-albus_anon=abc; __Host-albus_session=${token}; other=1`)).toBe(token);
    expect(sessionTokenFromCookieHeader([`__Host-albus_session=${token}`, "x=y"])).toBe(token);
    expect(cookieValue("a=1; a=2", "a")).toBe("1");
  });

  it("ignores a missing, empty or malformed session cookie", () => {
    expect(sessionTokenFromCookieHeader(undefined)).toBeUndefined();
    expect(sessionTokenFromCookieHeader("")).toBeUndefined();
    expect(sessionTokenFromCookieHeader("__Host-albus_session=")).toBeUndefined();
    expect(sessionTokenFromCookieHeader("__Host-albus_session=short")).toBeUndefined();
    expect(sessionTokenFromCookieHeader(`__Host-albus_session=${token}=`)).toBeUndefined();
    expect(sessionTokenFromCookieHeader(`albus_session=${token}`)).toBeUndefined();
  });

  it("sets __Host- cookies: Path=/, Secure, HttpOnly, SameSite=Lax, no Domain", () => {
    expect(sessionSetCookie(token)).toBe(`__Host-albus_session=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000`);
    expect(sessionSetCookie(token, 60)).toMatch(/Max-Age=60$/);
    expect(sessionClearCookie()).toBe("__Host-albus_session=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0");
    expect(anonOwnerClearCookie()).toBe("__Host-albus_anon=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0");
    for (const line of [sessionSetCookie(token), sessionClearCookie(), anonOwnerClearCookie()]) expect(line).not.toMatch(/Domain/i);
  });
});
