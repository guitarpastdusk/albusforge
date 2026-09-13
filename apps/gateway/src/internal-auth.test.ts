import type { OAuth2Client } from "google-auth-library";
import { describe, expect, it, vi } from "vitest";
import { clientIp, clientIpFromXff, googleInternalAuthVerifier, untrustingVerifier } from "./internal-auth";

const SA = "web@project.iam.gserviceaccount.com";
const AUD = "https://gateway-123.us-central1.run.app";

function fakeClient(payload: Record<string, unknown> | Error) {
  const verifyIdToken = vi.fn(async (options: { idToken: string; audience?: string | string[] }) => {
    if (payload instanceof Error) throw payload;
    if (options.audience !== AUD) throw new Error("wrong audience passed");
    return { getPayload: () => payload };
  });
  return { verifyIdToken } as unknown as Pick<OAuth2Client, "verifyIdToken"> & { verifyIdToken: typeof verifyIdToken };
}

describe("googleInternalAuthVerifier", () => {
  const now = 1_700_000_000_000;
  const good = { email: SA, email_verified: true, exp: now / 1000 + 3600, aud: AUD };

  it("accepts a verified token for the SSR service account and remembers it until it expires", async () => {
    const client = fakeClient(good);
    const verifier = googleInternalAuthVerifier({ audience: AUD, serviceAccount: SA, client, now: () => now });
    expect(await verifier.verify("tok")).toBe(true);
    expect(await verifier.verify("tok")).toBe(true);
    expect(client.verifyIdToken).toHaveBeenCalledTimes(1);
    expect(client.verifyIdToken).toHaveBeenCalledWith({ idToken: "tok", audience: AUD });
  });

  it("re-verifies once the remembered expiry has passed", async () => {
    let clock = now;
    const client = fakeClient(good);
    const verifier = googleInternalAuthVerifier({ audience: AUD, serviceAccount: SA, client, now: () => clock });
    await verifier.verify("tok");
    clock = now + 3601 * 1000;
    await verifier.verify("tok");
    expect(client.verifyIdToken).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["another account", { ...good, email: "attacker@project.iam.gserviceaccount.com" }],
    ["an unverified email", { ...good, email_verified: false }],
    ["no email", { exp: good.exp }],
    ["a signature or audience failure", new Error("invalid token")],
  ])("rejects %s", async (_what, payload) => {
    const verifier = googleInternalAuthVerifier({ audience: AUD, serviceAccount: SA, client: fakeClient(payload), now: () => now });
    expect(await verifier.verify("tok")).toBe(false);
  });

  it("compares the service account case-insensitively", async () => {
    const verifier = googleInternalAuthVerifier({ audience: AUD, serviceAccount: SA.toUpperCase(), client: fakeClient(good), now: () => now });
    expect(await verifier.verify("tok")).toBe(true);
  });
});

describe("clientIpFromXff", () => {
  it("takes the entry before the trusted hops, trimming spaces", () => {
    expect(clientIpFromXff("1.2.3.4, 35.1.1.1", 1)).toBe("1.2.3.4");
    expect(clientIpFromXff("9.9.9.9,1.2.3.4,35.1.1.1", 1)).toBe("1.2.3.4");
    expect(clientIpFromXff("2001:db8::1, 35.1.1.1", 1)).toBe("2001:db8::1");
    expect(clientIpFromXff("1.2.3.4, 10.0.0.1, 35.1.1.1", 2)).toBe("1.2.3.4");
  });

  it("is undefined with too few entries or a non-address, never the client's own first entry", () => {
    expect(clientIpFromXff("35.1.1.1", 1)).toBeUndefined();
    expect(clientIpFromXff(undefined, 1)).toBeUndefined();
    expect(clientIpFromXff("", 1)).toBeUndefined();
    expect(clientIpFromXff("evil, 35.1.1.1", 1)).toBeUndefined();
  });
});

describe("clientIp", () => {
  const trusting = { verify: vi.fn(async (token: string) => token === "good") };
  const options = { verifier: trusting, trustedProxyHops: 1 };

  it("uses X-Albus-Client-IP only when the internal auth token verifies", async () => {
    const headers = { "x-albus-internal-auth": "Bearer good", "x-albus-client-ip": "203.0.113.9", "x-forwarded-for": "10.9.9.9, 35.1.1.1" };
    expect(await clientIp({ headers, ip: "10.0.0.2" }, options)).toBe("203.0.113.9");
    expect(await clientIp({ headers: { ...headers, "x-albus-internal-auth": "Bearer bad" }, ip: "10.0.0.2" }, options)).toBe("10.9.9.9");
    expect(await clientIp({ headers, ip: "10.0.0.2" }, { ...options, verifier: untrustingVerifier })).toBe("10.9.9.9");
  });

  it("ignores a forwarded value that is not an IP address, without calling the verifier", async () => {
    const verify = vi.fn(async () => true);
    const headers = { "x-albus-internal-auth": "Bearer good", "x-albus-client-ip": "203.0.113.9; drop", "x-forwarded-for": "1.2.3.4, 35.1.1.1" };
    expect(await clientIp({ headers, ip: "10.0.0.2" }, { verifier: { verify }, trustedProxyHops: 1 })).toBe("1.2.3.4");
    expect(verify).not.toHaveBeenCalled();
  });

  it("falls back to the socket address", async () => {
    expect(await clientIp({ headers: {}, ip: "10.0.0.2" }, options)).toBe("10.0.0.2");
    expect(await clientIp({ headers: { "x-forwarded-for": "35.1.1.1" }, ip: "10.0.0.2" }, options)).toBe("10.0.0.2");
  });
});
