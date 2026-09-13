"use server";

import {
  BuildDetail,
  CreateBuildRequest,
  CreateBuildResponse,
  Id,
  MessageList,
  PostMessageRequest,
  routes,
} from "@albusforge/schema";
import { z } from "zod";
import type { BuildTranscript } from "@/components/build/conversation";
import { actionFailure } from "@/lib/action-errors";
import type { ActionResult } from "@/lib/action-result";
import { apiGet, apiPost } from "@/lib/api/server";

/*
 * The build conversation, called from the browser. Each call goes through the
 * server API client, so mock/live mode, the internal token and the forwarded
 * __Host- cookies (the anonymous owner, then the session) all apply.
 * Authorization is gateway's: it scopes every read and write to that owner.
 */

async function transcript(buildId: string): Promise<BuildTranscript> {
  const [build, { messages }] = await Promise.all([
    apiGet(routes.builds.get.path(buildId), BuildDetail),
    apiGet(routes.builds.messages.path(buildId), MessageList),
  ]);
  return { buildId, messages, ready: build.ready };
}

/** POST /v1/builds — the ask becomes the first message. */
export async function startBuild(askText: string): Promise<ActionResult<BuildTranscript>> {
  const parsed = CreateBuildRequest.safeParse({ ask_text: askText });
  if (!parsed.success) return { ok: false, message: "Describe the device you want to start." };

  try {
    const { build_id } = await apiPost(routes.builds.create.path(), CreateBuildResponse, parsed.data);
    // TODO(M2): assistant replies stream over GET /v1/builds/:id/events. Until
    // the SSE hookup lands, read the transcript back (the mock replies inline).
    return { ok: true, data: await transcript(build_id) };
  } catch (error) {
    return actionFailure("startBuild", error);
  }
}

/** POST /v1/builds/:id/messages → 202, then the transcript. */
export async function sendBuildMessage(buildId: string, text: string): Promise<ActionResult<BuildTranscript>> {
  const id = Id.safeParse(buildId);
  const parsed = PostMessageRequest.safeParse({ text });
  if (!id.success || !parsed.success) return { ok: false, message: "Write a reply to send." };

  try {
    await apiPost(routes.builds.postMessage.path(id.data), z.unknown(), parsed.data);
    return { ok: true, data: await transcript(id.data) };
  } catch (error) {
    return actionFailure("sendBuildMessage", error);
  }
}
