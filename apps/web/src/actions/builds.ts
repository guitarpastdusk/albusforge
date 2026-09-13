"use server";

import { BuildDetail, CreateBuildRequest, CreateBuildResponse, Id, MessageList, PostMessageRequest, routes } from "@albusforge/schema";
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
const SinceInput = z.number().int().nonnegative();

async function readTranscript(client: SessionClient, buildId: string): Promise<BuildTranscript> {
  const [build, { messages }] = await Promise.all([
    client.get(routes.builds.get.path(buildId), BuildDetail),
    client.get(routes.builds.messages.path(buildId), MessageList),
  ]);
  return { buildId, messages, ready: build.ready };
}

/** Gateway accepts a message and replies later: poll for the reply, or hand back the transcript to check again. */
async function awaitReply(client: SessionClient, buildId: string, sinceAssistantCount: number): Promise<ConversationResult> {
  const result = await waitForReply(() => readTranscript(client, buildId), sinceAssistantCount);
  return result.status === "replied"
    ? { ok: true, data: result.transcript }
    : { ok: false, message: STALLED_MESSAGE, awaitingReply: result.transcript };
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
    return await awaitReply(client, build_id, 0);
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
    const before = await client.get(routes.builds.messages.path(id.data), MessageList);
    await client.mutate("POST", routes.builds.postMessage.path(id.data), z.unknown(), parsed.data);
    return await awaitReply(client, id.data, assistantCount(before.messages));
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

    return await awaitReply(await sessionClient(), id.data, since.data);
  } catch (error) {
    return actionFailure("checkForReply", error);
  }
}
