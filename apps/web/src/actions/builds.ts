"use server";

import {
  BuildDetail,
  type ChatMessage,
  CreateBuildRequest,
  CreatedBuild,
  Id,
  MessageList,
  PostMessageRequest,
  PostMessageResponse,
  routes,
} from "@albusforge/schema";
import { z } from "zod";
import { actionFailure } from "@/lib/action-errors";
import type { ActionResult } from "@/lib/action-result";
import { ApiRequestError } from "@/lib/api/core";
import { sessionClient } from "@/lib/api/server";
import { localMessageId, transcriptFrom, type BuildTranscript } from "@/lib/build-transcript";

/*
 * The build conversation, called from the browser. Arguments are untrusted
 * serialized values: every one is validated at runtime, inside `try`, before
 * use. Calls go through `sessionClient()`, so mock/live mode, the internal
 * token and the __Host- cookie allowlist apply, and gateway's credential
 * cookies are relayed. Authorization is gateway's: every build route is
 * scoped to the forwarded session or anonymous owner (404 otherwise).
 *
 * Sends return once gateway has accepted the message. Replies arrive over
 * GET /v1/builds/:id/events (BuildConversation); `refreshBuild` reads the
 * build again, for "Check for a reply" and after the stream reconnects.
 */

/** Client-generated per message, so a retried send is idempotent: gateway returns the stored message instead of a new turn. */
const ClientMessageId = z.uuid();
const READ_TIMEOUT_MS = 10_000;
const REFRESH_FAILED_MESSAGE = "We couldn’t load the latest build details. Try again in a moment.";

function retryAfterSeconds(error: ApiRequestError): number | null {
  const details = error.details as { retry_after_s?: unknown } | undefined;
  const seconds = details?.retry_after_s;
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : null;
}

const waitFor = (seconds: number | null) => (seconds ? `wait about ${seconds} ${seconds === 1 ? "second" : "seconds"}` : "wait a moment");

/**
 * Gateway refused the turn before accepting it: 429 RATE_LIMITED, or 409
 * TURN_IN_PROGRESS while the last message is still unanswered. Nothing was
 * sent, so the UI gives the text back. Expected, so not logged.
 */
function refusedTurn(error: unknown): { ok: false; message: string } | null {
  if (!(error instanceof ApiRequestError)) return null;
  if (error.status === 429) {
    return { ok: false, message: `That’s a lot of messages at once. Your message wasn’t sent: ${waitFor(retryAfterSeconds(error))}, then send it again.` };
  }
  if (error.status === 409 && error.code === "TURN_IN_PROGRESS") {
    return { ok: false, message: "Still working on the last reply. Your message wasn’t sent: send it again once the reply arrives." };
  }
  return null;
}

/** POST /v1/builds: the ask becomes the first message. Returns the build and its transcript so far. */
export async function startBuild(askText: unknown, clientMessageId: unknown): Promise<ActionResult<BuildTranscript>> {
  try {
    const clientId = ClientMessageId.safeParse(clientMessageId);
    const parsed = CreateBuildRequest.safeParse({ ask_text: askText, client_message_id: clientMessageId });
    if (!clientId.success || !parsed.success) return { ok: false, message: "Describe the device you want to start." };

    const client = await sessionClient();
    // For an anonymous visitor gateway sets __Host-albus_anon: relayed to the
    // browser, and carried by the read below.
    const created = await client.mutate("POST", routes.builds.create.path(), CreatedBuild, parsed.data);
    const detail = { ...created, id: created.build_id };

    try {
      const { messages } = await client.get(routes.builds.messages.path(created.build_id), MessageList, {
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      });
      return { ok: true, data: transcriptFrom(detail, messages) };
    } catch (error) {
      // The build exists, so the ask isn't unsent: show it (logged once). The
      // event stream replays the transcript when it connects.
      await actionFailure("startBuild", error);
      const ask: ChatMessage = {
        id: localMessageId(clientId.data),
        role: "user",
        text: parsed.data.ask_text,
        created_at: new Date().toISOString(),
        client_message_id: clientId.data,
      };
      return { ok: true, data: transcriptFrom(detail, [ask]) };
    }
  } catch (error) {
    return refusedTurn(error) ?? actionFailure("startBuild", error);
  }
}

/** POST /v1/builds/:id/messages → 202 { message } (200 for a replayed client_message_id). */
export async function sendBuildMessage(buildId: unknown, text: unknown, clientMessageId: unknown): Promise<ActionResult<{ message: ChatMessage }>> {
  try {
    const id = Id.safeParse(buildId);
    const clientId = ClientMessageId.safeParse(clientMessageId);
    const parsed = PostMessageRequest.safeParse({ text, client_message_id: clientMessageId });
    if (!id.success || !clientId.success || !parsed.success) return { ok: false, message: "Write a reply to send." };

    const client = await sessionClient();
    const { message } = await client.mutate("POST", routes.builds.postMessage.path(id.data), PostMessageResponse, parsed.data);
    return { ok: true, data: { message } };
  } catch (error) {
    return refusedTurn(error) ?? actionFailure("sendBuildMessage", error);
  }
}

/**
 * GET the build and its messages. Never resends: if the last message is still
 * unanswered after 60 s, gateway itself starts the turn again on this read.
 */
export async function refreshBuild(buildId: unknown): Promise<ActionResult<BuildTranscript>> {
  try {
    const id = Id.safeParse(buildId);
    if (!id.success) return { ok: false, message: "Reload the page to see the latest reply." };

    const client = await sessionClient();
    const signal = AbortSignal.timeout(READ_TIMEOUT_MS);
    const [detail, { messages }] = await Promise.all([
      client.get(routes.builds.get.path(id.data), BuildDetail, { signal }),
      client.get(routes.builds.messages.path(id.data), MessageList, { signal }),
    ]);
    return { ok: true, data: transcriptFrom(detail, messages) };
  } catch (error) {
    return actionFailure("refreshBuild", error, REFRESH_FAILED_MESSAGE);
  }
}
