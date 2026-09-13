import { ANON_OWNER_COOKIE, SESSION_COOKIE } from "@albusforge/schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clientIpFromXff, forwardedCookies, gatewayHeaders } from "./gateway-headers.server";
import { clearIdTokenCache, idToken } from "./id-token.server";

const CLIENT = "203.0.113.9";
const LB = "34.120.0.1";
const CLOUD_RUN = "169.254.1.1";

describe("gatewayHeaders", () => {
  it("assembles token, original host, client IP and the allowlisted cookies", () => {
    const headers = gatewayHeaders(
      {
        host: "acme-plant.albusforge.ai",
        forwardedFor: `${CLIENT}, ${LB}`,
        cookie: `theme=dark; ${SESSION_COOKIE}=sess.sig; _ga=GA1.2; ${ANON_OWNER_COOKIE}=anon.sig`,
      },
      "id-token",
      1,
    );

    expect(headers).toEqual({
      "x-albus-internal-auth": "Bearer id-token",
      "x-albus-original-host": "acme-plant.albusforge.ai",
      "x-albus-client-ip": CLIENT,
      cookie: `${SESSION_COOKIE}=sess.sig; ${ANON_OWNER_COOKIE}=anon.sig`,
    });
  });

  it("sends no client IP header when X-Forwarded-For has too few entries", () => {
    const headers = gatewayHeaders({ host: "albusforge.ai", forwardedFor: CLIENT, cookie: null }, null, 1);
    expect(headers).not.toHaveProperty("x-albus-client-ip");
  });

  it("omits what it doesn't have — mock mode and cookie-less visitors", () => {
    expect(gatewayHeaders({ host: null, forwardedFor: null, cookie: "theme=dark" }, null, 1)).toEqual({});
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

describe("clientIpFromXff", () => {
  it("ignores a spoofed client-supplied prefix (hops=1)", () => {
    expect(clientIpFromXff(`1.2.3.4, ${CLIENT}, ${LB}`, 1)).toBe(CLIENT);
  });

  it("returns the client from '<client>, <lb>' (hops=1)", () => {
    expect(clientIpFromXff(`${CLIENT}, ${LB}`, 1)).toBe(CLIENT);
  });

  it("returns undefined for a single entry with hops=1 — never entry 0", () => {
    expect(clientIpFromXff(CLIENT, 1)).toBeUndefined();
  });

  it.each([null, undefined, "", " , "])("returns undefined for %j", (header) => {
    expect(clientIpFromXff(header, 1)).toBeUndefined();
  });

  it("skips a Cloud Run hop appended after the LB (hops=2)", () => {
    expect(clientIpFromXff(`1.2.3.4, ${CLIENT}, ${LB}, ${CLOUD_RUN}`, 2)).toBe(CLIENT);
  });

  it("trims whitespace around entries", () => {
    expect(clientIpFromXff(`  1.2.3.4 ,${CLIENT}   ,\t${LB}  `, 1)).toBe(CLIENT);
  });

  it("returns the last entry with hops=0", () => {
    expect(clientIpFromXff(`1.2.3.4, ${CLIENT}, ${LB}`, 0)).toBe(LB);
  });

  it("rejects a negative or fractional hop count", () => {
    expect(() => clientIpFromXff(CLIENT, -1)).toThrow(RangeError);
    expect(() => clientIpFromXff(CLIENT, 1.5)).toThrow(RangeError);
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
