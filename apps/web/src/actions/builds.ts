"use server";

import { BuildDetail, type ChatMessage, CreateBuildRequest, CreateBuildResponse, Id, MessageList, PostMessageRequest, routes } from "@albusforge/schema";
import { z } from "zod";
import { actionFailure } from "@/lib/action-errors";
import { sessionClient } from "@/lib/api/server";
import type { SessionClient } from "@/lib/api/session-client";
import { assistantCount, waitForReply, type BuildTranscript, type ConversationResult } from "@/lib/build-transcript";

/*
 * The build conversation, called from the browser. Arguments are untrusted
 * serialized values: every one is validated at runtime, inside `try`, before
 * use. Calls go through `sessionClient()`, so mock/live mode, the internal
 * token and the __Host- cookie allowlist apply, and gateway's credential
 * cookies are relayed. Authorization is gateway's: it scopes every read and
 * write to the forwarded session or anonymous owner.
 */

const STALLED_MESSAGE = "Your message was sent, but the reply is taking longer than usual.";
const READ_FAILED_MESSAGE = "Your message was sent, but we couldn’t load the reply.";
/** The read before sending: nothing is sent yet, so failing it is a plain failed send. */
const PRE_SEND_READ_TIMEOUT_MS = 10_000;
const SinceInput = z.number().int().nonnegative();

async function readTranscript(client: SessionClient, buildId: string, signal?: AbortSignal): Promise<BuildTranscript> {
  const [build, { messages }] = await Promise.all([
    client.get(routes.builds.get.path(buildId), BuildDetail, { signal }),
    client.get(routes.builds.messages.path(buildId), MessageList, { signal }),
  ]);
  return { buildId, messages, ready: build.ready };
}

/** What gateway has accepted, for when no transcript read finishes: the known messages plus the one just sent. */
function pendingTranscript(buildId: string, messages: ChatMessage[], text: string): BuildTranscript {
  return {
    buildId,
    ready: null,
    messages: [...messages, { id: `pending-${messages.length + 1}`, role: "user", text, created_at: new Date().toISOString() }],
  };
}

/**
 * Gateway accepted a message and replies later: poll for the reply within the
 * deadline. The message is never reported as unsent from here on — a timeout
 * or a failed read hands back the transcript (the latest read, else
 * `fallback`) so the UI offers to check again rather than to resend.
 */
async function awaitReply(
  action: string,
  client: SessionClient,
  buildId: string,
  sinceAssistantCount: number,
  fallback: BuildTranscript | null,
): Promise<ConversationResult> {
  try {
    const result = await waitForReply((signal) => readTranscript(client, buildId, signal), sinceAssistantCount);
    if (result.status === "replied") return { ok: true, data: result.transcript };
    const transcript = result.transcript ?? fallback;
    return transcript ? { ok: false, message: STALLED_MESSAGE, awaitingReply: transcript } : { ok: false, message: STALLED_MESSAGE };
  } catch (error) {
    // A real failure (not the deadline): logged once, still not a failed send.
    const failure = await actionFailure(action, error, READ_FAILED_MESSAGE);
    return fallback ? { ...failure, awaitingReply: fallback } : failure;
  }
}

/** POST /v1/builds — the ask becomes the first message; then wait for the first reply. */
export async function startBuild(askText: unknown): Promise<ConversationResult> {
  try {
    const parsed = CreateBuildRequest.safeParse({ ask_text: askText });
    if (!parsed.success) return { ok: false, message: "Describe the device you want to start." };

    const client = await sessionClient();
    // For an anonymous visitor this sets __Host-albus_anon: relayed to the
    // browser, and carried by this client's transcript reads below.
    const { build_id } = await client.mutate("POST", routes.builds.create.path(), CreateBuildResponse, parsed.data);
    return await awaitReply("startBuild", client, build_id, 0, pendingTranscript(build_id, [], parsed.data.ask_text));
  } catch (error) {
    return actionFailure("startBuild", error);
  }
}

/** POST /v1/builds/:id/messages → 202; then wait for the reply. */
export async function sendBuildMessage(buildId: unknown, text: unknown): Promise<ConversationResult> {
  try {
    const id = Id.safeParse(buildId);
    const parsed = PostMessageRequest.safeParse({ text });
    if (!id.success || !parsed.success) return { ok: false, message: "Write a reply to send." };

    const client = await sessionClient();
    const before = await client.get(routes.builds.messages.path(id.data), MessageList, {
      signal: AbortSignal.timeout(PRE_SEND_READ_TIMEOUT_MS),
    });
    await client.mutate("POST", routes.builds.postMessage.path(id.data), z.unknown(), parsed.data);
    return await awaitReply(
      "sendBuildMessage",
      client,
      id.data,
      assistantCount(before.messages),
      pendingTranscript(id.data, before.messages, parsed.data.text),
    );
  } catch (error) {
    return actionFailure("sendBuildMessage", error);
  }
}

/** Check again for a reply that timed out, without resending the message. */
export async function checkForReply(buildId: unknown, sinceAssistantCount: unknown): Promise<ConversationResult> {
  try {
    const id = Id.safeParse(buildId);
    const since = SinceInput.safeParse(sinceAssistantCount);
    if (!id.success || !since.success) return { ok: false, message: "Reload the page to see the latest reply." };

    return await awaitReply("checkForReply", await sessionClient(), id.data, since.data, null);
  } catch (error) {
    return actionFailure("checkForReply", error);
  }
}
