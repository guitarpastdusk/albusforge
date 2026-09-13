import type { ChatMessage } from "@albusforge/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assistantCount, ReplyDeadlineError, ReplyDoneError, waitForReply, type BuildTranscript, type ReplyWait } from "./build-transcript";

const AT = "2026-09-13T12:00:00Z";
const msg = (id: string, role: ChatMessage["role"], text: string): ChatMessage => ({ id, role, text, created_at: AT });
const transcript = (messages: ChatMessage[]): BuildTranscript => ({ buildId: "b1", messages, ready: null });

const PENDING = transcript([msg("1", "user", "hi")]);
const REPLIED = transcript([msg("1", "user", "hi"), msg("2", "assistant", "hello")]);

/** Tracks whether a promise has settled, so a test can assert it is still pending. */
function track<T>(promise: Promise<T>) {
  const state: { settled: boolean; value?: T; at?: number } = { settled: false };
  void promise.then((value) => Object.assign(state, { settled: true, value, at: Date.now() }));
  return state;
}

/** A read that resolves after `ms`, or rejects with the abort reason (clearing its timer) when aborted. */
function slowRead(ms: number, value: BuildTranscript) {
  const seen: { signal?: AbortSignal; rejectedWith?: unknown } = {};
  const read = (signal: AbortSignal) =>
    new Promise<BuildTranscript>((resolve, reject) => {
      seen.signal = signal;
      const timer = setTimeout(() => resolve(value), ms);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          seen.rejectedWith = signal.reason;
          reject(signal.reason);
        },
        { once: true },
      );
    });
  return { read, seen };
}

beforeEach(() => {
  vi.useFakeTimers({ now: 0 });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("waitForReply", () => {
  it("returns at once when the first read already has the reply, leaving no timers", async () => {
    const read = vi.fn<(signal: AbortSignal) => Promise<BuildTranscript>>(async () => REPLIED);
    await expect(waitForReply(read, 0)).resolves.toEqual({ status: "replied", transcript: REPLIED, reads: 1 });
    expect(Date.now()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    // Aborted only after the reply was fully read: nothing is left in flight.
    expect(read.mock.calls[0]![0].reason).toBeInstanceOf(ReplyDoneError);
  });

  it("keeps reading, with backoff, until the reply shows up on a later read", async () => {
    const before = [msg("1", "user", "hi"), msg("2", "assistant", "hello"), msg("3", "user", "one bed")];
    const reads = [transcript(before), transcript(before), transcript([...before, msg("4", "assistant", "Got it.")])];
    const at: number[] = [];
    let i = 0;
    const result = track(
      waitForReply(async () => {
        at.push(Date.now());
        return reads[Math.min(i++, reads.length - 1)]!;
      }, 1),
    );

    await vi.advanceTimersByTimeAsync(1_000);
    expect(result.settled).toBe(true);
    expect(result.value).toMatchObject({ status: "replied", reads: 3 });
    expect(result.value!.transcript!.messages.at(-1)!.text).toBe("Got it.");
    expect(at).toEqual([0, 300, 900]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("doesn't mistake an earlier reply for the new one", async () => {
    const stale = transcript([msg("1", "user", "hi"), msg("2", "assistant", "hello"), msg("3", "user", "again")]);
    const result = track(waitForReply(async () => stale, 1, { timeoutMs: 1_000 }));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(result.value).toMatchObject({ status: "timeout", transcript: stale });
  });

  it("a first read that never finishes returns timeout at the deadline, aborted, with no transcript", async () => {
    let signal: AbortSignal | undefined;
    const result = track(
      waitForReply((s) => {
        signal = s;
        return new Promise<BuildTranscript>(() => {});
      }, 0),
    );

    await vi.advanceTimersByTimeAsync(19_999);
    expect(result.settled).toBe(false);
    expect(signal!.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(result.value).toEqual({ status: "timeout", transcript: null, reads: 0 });
    expect(result.at).toBe(20_000);
    expect(signal!.aborted).toBe(true);
    expect(signal!.reason).toBeInstanceOf(ReplyDeadlineError);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a slow later read crossing the deadline is aborted, and the wait ends at the deadline with the latest transcript", async () => {
    const fast = vi.fn(async () => PENDING);
    const slow = slowRead(5_000, REPLIED);
    let calls = 0;
    const result = track(waitForReply((signal) => (++calls <= 2 ? fast() : slow.read(signal)), 0, { timeoutMs: 1_000 }));

    // Reads at 0 and 300; the third starts at 900 and would take until 5 900.
    await vi.advanceTimersByTimeAsync(999);
    expect(result.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(result.value).toEqual<ReplyWait>({ status: "timeout", transcript: PENDING, reads: 2 });
    expect(result.at).toBe(1_000);
    expect(slow.seen.signal!.aborted).toBe(true);
    expect(slow.seen.rejectedWith).toBeInstanceOf(ReplyDeadlineError);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ends at the deadline mid-pause, without waiting out the backoff", async () => {
    const at: number[] = [];
    const result = track(
      waitForReply(
        async () => {
          at.push(Date.now());
          return PENDING;
        },
        0,
        { timeoutMs: 8_000 },
      ),
    );
    await vi.advanceTimersByTimeAsync(8_000);
    expect(result.value).toMatchObject({ status: "timeout", transcript: PENDING, reads: 6 });
    expect(result.at).toBe(8_000);
    expect(at).toEqual([0, 300, 900, 2_100, 4_100, 6_100]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a read that fails before the deadline aborts its sibling work with the original error, rethrows it, and clears its timers", async () => {
    const failure = new Error("gateway 503");
    const sibling = slowRead(60_000, PENDING);
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      // Like readTranscript: two requests under one Promise.all, one fails fast while the other hangs.
      const outcome = waitForReply((signal) => Promise.all([Promise.reject(failure), sibling.read(signal)]).then(([t]) => t), 0).catch(
        (error: unknown) => error,
      );
      expect(await outcome).toBe(failure);
      expect(sibling.seen.signal!.aborted).toBe(true);
      expect(sibling.seen.signal!.reason).toBe(failure);
      expect(sibling.seen.rejectedWith).toBe(failure);
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(30_000);
      // Real timers for the flush: Node reports unhandled rejections after the microtask queue drains.
      vi.useRealTimers();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("aborts its signal once done after a reply and after a timeout, never classifying either as a failure", async () => {
    let replySignal: AbortSignal | undefined;
    await expect(
      waitForReply(async (s) => {
        replySignal = s;
        return REPLIED;
      }, 0),
    ).resolves.toMatchObject({ status: "replied" });
    expect(replySignal!.reason).toBeInstanceOf(ReplyDoneError);

    let timeoutSignal: AbortSignal | undefined;
    const result = track(
      waitForReply(
        async (s) => {
          timeoutSignal = s;
          return PENDING;
        },
        0,
        { timeoutMs: 500 },
      ),
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(result.value).toMatchObject({ status: "timeout", transcript: PENDING });
    expect(timeoutSignal!.reason).toBeInstanceOf(ReplyDeadlineError);
  });

  it("a read that rejects synchronously on abort still reads as a timeout, not a failure", async () => {
    const result = track(
      waitForReply(
        (signal) =>
          new Promise<BuildTranscript>((_, reject) => {
            signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
          }),
        0,
        { timeoutMs: 50 },
      ),
    );
    await vi.advanceTimersByTimeAsync(50);
    expect(result.value).toEqual({ status: "timeout", transcript: null, reads: 0 });
  });

  it("adds no event listeners of its own", async () => {
    const add = vi.spyOn(EventTarget.prototype, "addEventListener");
    const pending = track(waitForReply(async () => PENDING, 0, { timeoutMs: 1_000 }));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(pending.value!.status).toBe("timeout");
    await waitForReply(async () => REPLIED, 0);
    expect(add).not.toHaveBeenCalled();
  });

  it("counts assistant messages", () => {
    expect(assistantCount([msg("1", "user", "a"), msg("2", "assistant", "b"), msg("3", "assistant", "c")])).toBe(2);
  });
});
