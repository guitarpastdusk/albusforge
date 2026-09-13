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
  timeoutMs?: number;
  firstDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface ReplyWait {
  status: "replied" | "timeout";
  transcript: BuildTranscript;
  reads: number;
}

/**
 * Read the transcript until a new assistant message ends it, backing off
 * between reads (300 ms doubling to 2 s), or give up after `timeoutMs`.
 *
 * Gateway accepts a message with 202 and delivers the reply later (over
 * GET /v1/builds/:id/events). Polling from the Server Function works in both
 * API modes without a browser connection to /v1.
 */
export async function waitForReply(
  read: () => Promise<BuildTranscript>,
  sinceAssistantCount: number,
  {
    timeoutMs = 20_000,
    firstDelayMs = 300,
    maxDelayMs = 2_000,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = Date.now,
  }: ReplyWaitOptions = {},
): Promise<ReplyWait> {
  const started = now();
  let delay = firstDelayMs;
  let reads = 0;

  for (;;) {
    const transcript = await read();
    reads += 1;
    const last = transcript.messages.at(-1);
    if (assistantCount(transcript.messages) > sinceAssistantCount && last?.role === "assistant") {
      return { status: "replied", transcript, reads };
    }
    if (now() - started + delay > timeoutMs) return { status: "timeout", transcript, reads };
    await sleep(delay);
    delay = Math.min(delay * 2, maxDelayMs);
  }
}
