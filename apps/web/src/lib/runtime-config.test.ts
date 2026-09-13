import { describe, expect, it } from "vitest";
import { loadRuntimeConfig, parseApiMode, parseTrustedProxyHops } from "./runtime-config";

describe("parseApiMode", () => {
  it("defaults to live", () => {
    expect(parseApiMode(undefined)).toBe("live");
    expect(parseApiMode("")).toBe("live");
  });

  it("accepts mock and live", () => {
    expect(parseApiMode("mock")).toBe("mock");
    expect(parseApiMode("live")).toBe("live");
  });

  it("rejects anything else", () => {
    expect(() => parseApiMode("MOCK")).toThrow(/API_MODE must be/);
  });
});

describe("parseTrustedProxyHops", () => {
  it("defaults to 1", () => {
    expect(parseTrustedProxyHops(undefined)).toBe(1);
    expect(parseTrustedProxyHops("")).toBe(1);
  });

  it("accepts non-negative integers, including 0", () => {
    expect(parseTrustedProxyHops("0")).toBe(0);
    expect(parseTrustedProxyHops("2")).toBe(2);
  });

  it.each(["-1", "1.5", "one", " 1", "1e1"])("rejects %j", (raw) => {
    expect(() => parseTrustedProxyHops(raw)).toThrow(/TRUSTED_PROXY_HOPS must be a non-negative integer/);
  });
});

describe("loadRuntimeConfig", () => {
  it("refuses mock mode on Cloud Run", () => {
    expect(() => loadRuntimeConfig({ API_MODE: "mock", K_SERVICE: "web" })).toThrow(
      /API_MODE=mock is not allowed on Cloud Run \(K_SERVICE="web"\)/,
    );
  });

  it("allows mock mode off Cloud Run", () => {
    expect(loadRuntimeConfig({ API_MODE: "mock" })).toEqual({ apiMode: "mock", trustedProxyHops: 1 });
  });

  it("allows live mode on Cloud Run, and the defaults", () => {
    expect(loadRuntimeConfig({ K_SERVICE: "web" })).toEqual({ apiMode: "live", trustedProxyHops: 1 });
  });

  it("surfaces an invalid hop count", () => {
    expect(() => loadRuntimeConfig({ TRUSTED_PROXY_HOPS: "-2" })).toThrow(/TRUSTED_PROXY_HOPS/);
  });
});
