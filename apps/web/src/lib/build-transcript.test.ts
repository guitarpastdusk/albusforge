import type { ChatMessage } from "@albusforge/schema";
import { describe, expect, it } from "vitest";
import { assistantCount, waitForReply, type BuildTranscript } from "./build-transcript";

const AT = "2026-09-13T12:00:00Z";
const msg = (id: string, role: ChatMessage["role"], text: string): ChatMessage => ({ id, role, text, created_at: AT });
const transcript = (messages: ChatMessage[]): BuildTranscript => ({ buildId: "b1", messages, ready: null });

/** A fake clock that advances by whatever the loop sleeps. */
function clock() {
  let t = 0;
  const slept: number[] = [];
  return { now: () => t, sleep: async (ms: number) => void (slept.push(ms), (t += ms)), slept };
}

describe("waitForReply", () => {
  it("keeps reading, with backoff, until the reply shows up on a later read", async () => {
    const before = [msg("1", "user", "hi"), msg("2", "assistant", "hello"), msg("3", "user", "one bed")];
    const reads = [transcript(before), transcript(before), transcript([...before, msg("4", "assistant", "Got it.")])];
    let i = 0;
    const { now, sleep, slept } = clock();

    const result = await waitForReply(async () => reads[Math.min(i++, reads.length - 1)]!, 1, { now, sleep });

    expect(result.status).toBe("replied");
    expect(result.reads).toBe(3);
    expect(result.transcript.messages.at(-1)!.text).toBe("Got it.");
    expect(slept).toEqual([300, 600]);
  });

  it("doesn't mistake an earlier reply for the new one", async () => {
    const { now, sleep } = clock();
    const stale = transcript([msg("1", "user", "hi"), msg("2", "assistant", "hello"), msg("3", "user", "again")]);
    const result = await waitForReply(async () => stale, 1, { now, sleep, timeoutMs: 1_000 });
    expect(result.status).toBe("timeout");
  });

  it("times out with the latest transcript after backing off to the cap", async () => {
    const { now, sleep, slept } = clock();
    const pending = transcript([msg("1", "user", "hi")]);
    const result = await waitForReply(async () => pending, 0, { now, sleep, timeoutMs: 8_000 });
    expect(result).toMatchObject({ status: "timeout", transcript: pending });
    expect(slept).toEqual([300, 600, 1200, 2000, 2000]);
    expect(slept.every((ms) => ms <= 2000)).toBe(true);
  });

  it("returns at once when the first read already has the reply (mock mode)", async () => {
    const { now, sleep, slept } = clock();
    const result = await waitForReply(async () => transcript([msg("1", "user", "hi"), msg("2", "assistant", "hello")]), 0, { now, sleep });
    expect(result).toMatchObject({ status: "replied", reads: 1 });
    expect(slept).toEqual([]);
  });

  it("counts assistant messages", () => {
    expect(assistantCount([msg("1", "user", "a"), msg("2", "assistant", "b"), msg("3", "assistant", "c")])).toBe(2);
  });
});
