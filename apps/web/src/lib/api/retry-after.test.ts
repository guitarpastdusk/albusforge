import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { fetchTransport, parseRetryAfter, request } from "./core";

afterEach(() => vi.unstubAllGlobals());
const NOW = Date.parse("2026-09-13T12:00:00Z");
describe("Retry-After metadata", () => {
  it("supports delay seconds and HTTP dates without manufacturing invalid deadlines", () => {
    expect(parseRetryAfter(" 90 ", NOW)).toBe(90);
    expect(parseRetryAfter("Sun, 13 Sep 2026 12:01:30 GMT", NOW)).toBe(90);
    expect(parseRetryAfter("Sun, 13 Sep 2026 11:59:59 GMT", NOW)).toBe(0);
    for (const value of [null, "", "-1", "2.5", "Infinity", "9007199254740993", "31536001", "September 2026", "private-email@example.test"]) expect(parseRetryAfter(value, NOW)).toBeUndefined();
  });
  it.each(["application/json", "text/html"])("preserves only parsed delay for a %s refusal", async (contentType) => {
    const body = contentType === "application/json" ? JSON.stringify({ error: { code: "RATE_LIMITED", message: "upstream refusal" } }) : "private intermediary response";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 429, headers: { "content-type": contentType, "retry-after": "17" } })));
    const result = request(fetchTransport("http://localhost"), "POST", "/v1/auth/code", z.unknown());
    await expect(result).rejects.toMatchObject(contentType === "application/json" ? { retryAfterSeconds: 17 } : { details: { retryAfterSeconds: 17 } });
  });
});
