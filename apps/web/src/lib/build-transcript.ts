import type { ChatMessage, DeviceReadyCard } from "@albusforge/schema";

/** The whole conversation and the ready card, if the plan is solved. */
export interface BuildTranscript {
  buildId: string;
  messages: ChatMessage[];
  ready: DeviceReadyCard | null;
}

/**
 * What the build Server Functions return. `awaitingReply` means the message
 * was accepted but no reply arrived in time — don't resend it; check again.
 */
export type ConversationResult =
  | { ok: true; data: BuildTranscript }
  | { ok: false; message: string; awaitingReply?: BuildTranscript };

export const assistantCount = (messages: readonly ChatMessage[]): number =>
  messages.filter((message) => message.role === "assistant").length;

export interface ReplyWaitOptions {
  /** Total budget, every read and pause included. */
  timeoutMs?: number;
  firstDelayMs?: number;
  maxDelayMs?: number;
}

export type ReplyWait =
  | { status: "replied"; transcript: BuildTranscript; reads: number }
  /** `transcript` is the latest completed read, or null if none finished in time. */
  | { status: "timeout"; transcript: BuildTranscript | null; reads: number };

/** The abort reason for a read cut off by the deadline. Expected, not a failure: never logged. */
export class ReplyDeadlineError extends Error {
  constructor(timeoutMs: number) {
    super(`no reply within ${timeoutMs} ms`);
    this.name = "ReplyDeadlineError";
  }
}

/** The abort reason once the wait is over: anything still in flight is no longer needed. */
export class ReplyDoneError extends Error {
  constructor() {
    super("reply wait finished");
    this.name = "ReplyDoneError";
  }
}

const DEADLINE = Symbol("deadline");

/**
 * Read the transcript until a new assistant message ends it, backing off
 * between reads (300 ms doubling to 2 s), or give up after `timeoutMs`.
 *
 * The deadline is total: a read still in flight when it passes (waiting for
 * headers or for the body) is aborted through `signal` and the wait returns
 * `timeout` at the deadline, not when the read ends. Nothing outlives the
 * call: its timers are cleared and its signal aborted on every outcome, and
 * it adds no listeners. A read that fails before the deadline aborts the
 * rest of that read (with the failure as the reason) and rethrows it.
 *
 * Gateway accepts a message with 202 and delivers the reply later (over
 * GET /v1/builds/:id/events). Polling from the Server Function works in both
 * API modes without a browser connection to /v1.
 */
export async function waitForReply(
  read: (signal: AbortSignal) => Promise<BuildTranscript>,
  sinceAssistantCount: number,
  { timeoutMs = 20_000, firstDelayMs = 300, maxDelayMs = 2_000 }: ReplyWaitOptions = {},
): Promise<ReplyWait> {
  const controller = new AbortController();
  let reachDeadline!: (value: typeof DEADLINE) => void;
  const deadline = new Promise<typeof DEADLINE>((resolve) => {
    reachDeadline = resolve;
  });
  const deadlineTimer = setTimeout(() => {
    // Settle the deadline before aborting, so a read that rejects
    // synchronously on abort can't win the race.
    reachDeadline(DEADLINE);
    controller.abort(new ReplyDeadlineError(timeoutMs));
  }, timeoutMs);
  let pauseTimer: ReturnType<typeof setTimeout> | undefined;
  const pause = (ms: number) =>
    new Promise<void>((resolve) => {
      pauseTimer = setTimeout(resolve, ms);
    });

  let latest: BuildTranscript | null = null;
  let reads = 0;
  let delay = firstDelayMs;
  const timedOut = (): ReplyWait => ({ status: "timeout", transcript: latest, reads });

  try {
    for (;;) {
      let outcome: BuildTranscript | typeof DEADLINE;
      try {
        outcome = await Promise.race([read(controller.signal), deadline]);
      } catch (error) {
        if (controller.signal.aborted) return timedOut();
        // A real failure: cancel whatever else the read still has in flight
        // (e.g. the sibling GET of a Promise.all), then rethrow the original.
        // Promise.all has already settled, so the sibling's abort rejection
        // is absorbed there: it can't replace this error or go unhandled.
        controller.abort(error);
        throw error;
      }
      if (outcome === DEADLINE) return timedOut();

      reads += 1;
      latest = outcome;
      const last = outcome.messages.at(-1);
      if (assistantCount(outcome.messages) > sinceAssistantCount && last?.role === "assistant") {
        return { status: "replied", transcript: outcome, reads };
      }
      if ((await Promise.race([pause(delay), deadline])) === DEADLINE) return timedOut();
      delay = Math.min(delay * 2, maxDelayMs);
    }
  } finally {
    clearTimeout(deadlineTimer);
    clearTimeout(pauseTimer);
    // Every exit leaves no request behind. On a reply the read has fully
    // resolved (bodies consumed), so this cancels nothing that is needed.
    if (!controller.signal.aborted) controller.abort(new ReplyDoneError());
  }
}
