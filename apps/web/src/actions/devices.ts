"use server";

import {
  AskRequest,
  AskResponse,
  DeviceConverseInput,
  DeviceConverseResponse,
  Id,
  routes,
  type ChatMessage,
} from "@albusforge/schema";
import { actionFailure } from "@/lib/action-errors";
import type { ActionResult } from "@/lib/action-result";
import { apiPost } from "@/lib/api/server";

/** POST /v1/devices/:id/ask — the device chat. Gateway binds tenant and device (PORTAL.md §3). Arguments are validated at runtime. */
export async function askDevice(deviceId: unknown, text: unknown, scope?: { channel: string; from: string; to: string }): Promise<ActionResult<ChatMessage>> {
  try {
    const id = Id.safeParse(deviceId);
    const parsed = AskRequest.safeParse({ ...scope, text });
    if (!id.success || !parsed.success) return { ok: false, message: "Ask a question to send." };

    const { message } = await apiPost(routes.devices.ask.path(id.data), AskResponse, parsed.data);
    return { ok: true, data: message };
  } catch (error) {
    return actionFailure("askDevice", error, "I can’t reach the service right now. Try again in a moment.");
  }
}

/**
 * POST /v1/devices/:id/chat — the multi-turn device conversation.
 *
 * Distinct from `askDevice`: that route classifies one question into a closed
 * intent, so no model prose reaches the page. This one returns the model's own
 * words, constrained instead by the queries it had to run to write them. The
 * gateway binds tenant and device from the session; nothing here is trusted.
 */
export async function chatWithDevice(
  deviceId: unknown,
  question: unknown,
  history: unknown,
): Promise<ActionResult<DeviceConverseResponse>> {
  try {
    const id = Id.safeParse(deviceId);
    const parsed = DeviceConverseInput.safeParse({ question, history });
    if (!id.success || !parsed.success) return { ok: false, message: "Ask a question to send." };

    const answer = await apiPost(routes.devices.chat.path(id.data), DeviceConverseResponse, parsed.data);
    return { ok: true, data: answer };
  } catch (error) {
    return actionFailure("chatWithDevice", error, "I can’t reach the service right now. Try again in a moment.");
  }
}
