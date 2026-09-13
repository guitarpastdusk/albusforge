import { describe, expect, it, vi } from "vitest";
import { CONNECTION_MESSAGE } from "@/lib/safe-action";
import { askOnce } from "./device-chat-flow";

describe("askOnce (device chat)", () => {
  it("a rejected call (network failure) resolves with the retryable connection message", async () => {
    await expect(askOnce(vi.fn().mockRejectedValue(new TypeError("Failed to fetch")))).resolves.toEqual({
      ok: false,
      message: CONNECTION_MESSAGE,
    });
  });

  it("an { ok: false } result resolves with the server's message", async () => {
    await expect(askOnce(async () => ({ ok: false, message: "I can’t reach the service right now." }))).resolves.toEqual({
      ok: false,
      message: "I can’t reach the service right now.",
    });
  });

  it("a reply resolves with its text", async () => {
    await expect(
      askOnce(async () => ({ ok: true, data: { id: "a1", role: "assistant", text: "Dropping slowly.", created_at: "2026-09-13T12:00:00Z" } })),
    ).resolves.toEqual({ ok: true, reply: "Dropping slowly." });
  });
});
