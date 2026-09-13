import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, GatewayError } from "@/lib/api/core";
import { sessionClient } from "@/lib/api/server";
import { requestSignInCode, verifySignInCode } from "./auth";
vi.mock("@/lib/api/server", () => ({ sessionClient: vi.fn() }));
vi.mock("@/lib/action-errors", () => ({ actionFailure: vi.fn(async (_action, _error, message = "Unavailable") => ({ ok: false, message })), actionIncomplete: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
function refuse(error: Error) {
  vi.mocked(sessionClient).mockResolvedValue({ mutate: vi.fn().mockRejectedValue(error), get: vi.fn(), credentialChange: vi.fn() });
}
describe("auth recovery responses", () => {
  it.each([new ApiRequestError(429, "RATE_LIMITED", "secret body", { retry_after_s: 999 }, 42), new GatewayError({ route: "POST /v1/auth/code", status: 429, reason: "unexpected_status", contentType: "text/html", retryAfterSeconds: 42 })])("returns sanitized actual retry metadata for send and verify", async (error) => {
    refuse(error);
    for (const result of [await requestSignInCode("a@example.test"), await verifySignInCode("a@example.test", "123456")]) {
      expect(result).toEqual({ ok: false, message: "Too many attempts. Wait before trying again.", retryAfterSeconds: 42 });
      expect(JSON.stringify(result)).not.toContain("secret");
    }
  });
  it("does not invent a deadline from arbitrary body details or malformed metadata", async () => {
    refuse(new ApiRequestError(429, "RATE_LIMITED", "secret", { retry_after_s: 999 }, Infinity));
    expect(await requestSignInCode("a@example.test")).toEqual({ ok: false, message: "Too many attempts. Wait before trying again." });
  });
  it("keeps incorrect, expired and exhausted code failures indistinguishable", async () => {
    refuse(new ApiRequestError(400, "INVALID_CODE", "private upstream details"));
    expect(await verifySignInCode("a@example.test", "123456")).toEqual({ ok: false, message: "That code didn’t work. It may be incorrect, expired, or replaced. Check the latest email, or request a new code." });
  });
  it("explains uncertain delivery without claiming email was sent", async () => {
    refuse(new Error("delivery failure"));
    const result = await requestSignInCode("a@example.test");
    expect(result.ok).toBe(false);
    expect(result).toHaveProperty("message", expect.stringContaining("couldn’t confirm the email was sent"));
  });
});
