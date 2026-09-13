import { ANON_OWNER_COOKIE, SESSION_COOKIE } from "@albusforge/schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clientIp, forwardedCookies, gatewayHeaders } from "./gateway-headers.server";
import { clearIdTokenCache, idToken } from "./id-token.server";

describe("gatewayHeaders", () => {
  it("assembles token, original host, client IP and the allowlisted cookies", () => {
    const headers = gatewayHeaders(
      {
        host: "acme-plant.albusforge.ai",
        forwardedFor: "203.0.113.9, 34.120.0.1",
        cookie: `theme=dark; ${SESSION_COOKIE}=sess.sig; _ga=GA1.2; ${ANON_OWNER_COOKIE}=anon.sig`,
      },
      "id-token",
    );

    expect(headers).toEqual({
      "x-albus-internal-auth": "Bearer id-token",
      "x-albus-original-host": "acme-plant.albusforge.ai",
      "x-albus-client-ip": "203.0.113.9",
      cookie: `${SESSION_COOKIE}=sess.sig; ${ANON_OWNER_COOKIE}=anon.sig`,
    });
  });

  it("omits what it doesn't have — mock mode and cookie-less visitors", () => {
    expect(gatewayHeaders({ host: null, forwardedFor: null, cookie: "theme=dark" }, null)).toEqual({});
  });
});

describe("forwardedCookies", () => {
  it("forwards both allowlisted cookies", () => {
    expect(forwardedCookies(`${ANON_OWNER_COOKIE}=a; ${SESSION_COOKIE}=s`)).toBe(
      `${SESSION_COOKIE}=s; ${ANON_OWNER_COOKIE}=a`,
    );
  });

  it("forwards only the session cookie when that is all there is", () => {
    expect(forwardedCookies(`theme=dark; ${SESSION_COOKIE}=s`)).toBe(`${SESSION_COOKIE}=s`);
  });

  it("forwards only the anonymous owner cookie when that is all there is", () => {
    expect(forwardedCookies(`${ANON_OWNER_COOKIE}=a; _ga=GA1.2`)).toBe(`${ANON_OWNER_COOKIE}=a`);
  });

  it("drops unrelated cookies, look-alike names and empty values", () => {
    expect(
      forwardedCookies(`theme=dark; albus_session=x; ${SESSION_COOKIE}_old=y; ${SESSION_COOKIE}=; _ga=GA1.2`),
    ).toBeNull();
  });

  it("returns null with no Cookie header", () => {
    expect(forwardedCookies(null)).toBeNull();
  });
});

describe("clientIp", () => {
  it("ignores a client-supplied X-Forwarded-For prefix", () => {
    expect(clientIp("6.6.6.6, 203.0.113.9, 34.120.0.1")).toBe("203.0.113.9");
  });

  it("takes a lone entry as-is (no load balancer, local dev)", () => {
    expect(clientIp("127.0.0.1")).toBe("127.0.0.1");
  });

  it("returns null for an empty header", () => {
    expect(clientIp(" , ")).toBeNull();
  });
});

describe("idToken", () => {
  afterEach(() => clearIdTokenCache());

  const jwt = (exp: number) => ["h", Buffer.from(JSON.stringify({ exp })).toString("base64url"), "s"].join(".");

  it("asks the metadata server for the audience, then caches until near expiry", async () => {
    const now = 1_800_000_000_000;
    const token = jwt(now / 1000 + 3600);
    const fetchImpl = vi.fn(async () => new Response(token));

    await expect(idToken("https://gateway.run.app", { now, fetchImpl })).resolves.toBe(token);
    await expect(idToken("https://gateway.run.app", { now: now + 30 * 60_000, fetchImpl })).resolves.toBe(token);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("audience=https%3A%2F%2Fgateway.run.app");
    expect(init.headers).toMatchObject({ "Metadata-Flavor": "Google" });

    // Inside the 5-minute refresh margin: fetch again.
    await idToken("https://gateway.run.app", { now: now + 56 * 60_000, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
