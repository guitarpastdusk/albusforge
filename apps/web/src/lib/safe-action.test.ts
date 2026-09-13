import { describe, expect, it, vi } from "vitest";
import { CONNECTION_MESSAGE, settle } from "./safe-action";

describe("settle", () => {
  it("turns a rejected call into a retryable failure with a safe message", async () => {
    const call = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(settle(call)).resolves.toEqual({ ok: false, message: CONNECTION_MESSAGE });
  });

  it("passes an { ok: false } result through with the server's own message", async () => {
    await expect(settle(async () => ({ ok: false as const, message: "Enter a valid email address." }))).resolves.toEqual({
      ok: false,
      message: "Enter a valid email address.",
    });
  });

  it("passes success through", async () => {
    await expect(settle(async () => ({ ok: true as const, data: 1 }))).resolves.toEqual({ ok: true, data: 1 });
  });

  it("never leaks the underlying error text", async () => {
    const result = await settle(async () => {
      throw new Error("ECONNREFUSED 10.10.0.7:8080 secret-internal-host");
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});
