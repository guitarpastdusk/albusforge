import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { anonOwnerSetCookie, anonTokenFromCookieHeader, hashAnonToken, newAnonToken } from "./owner";

describe("anonymous owner cookie", () => {
  it("issues 32 random bytes as base64url", () => {
    const token = newAnonToken();
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newAnonToken()).not.toBe(token);
  });

  it("stores the SHA-256 hex of the token", () => {
    const token = newAnonToken();
    expect(hashAnonToken(token)).toBe(createHash("sha256").update(token).digest("hex"));
  });

  it("sets a host-only, Secure, HttpOnly, Lax cookie for 30 days", () => {
    expect(anonOwnerSetCookie("tok")).toBe("__Host-albus_anon=tok; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000");
  });

  it("reads the cookie among others and ignores a malformed value", () => {
    const token = newAnonToken();
    expect(anonTokenFromCookieHeader(`theme=dark; __Host-albus_anon=${token}; __Host-albus_session=x`)).toBe(token);
    expect(anonTokenFromCookieHeader("__Host-albus_anon=short")).toBeUndefined();
    expect(anonTokenFromCookieHeader(`albus_anon=${token}`)).toBeUndefined();
    expect(anonTokenFromCookieHeader(undefined)).toBeUndefined();
  });
});
