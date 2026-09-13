"use server";

import { AskRequest, AskResponse, Id, routes, type ChatMessage } from "@albusforge/schema";
import { actionFailure } from "@/lib/action-errors";
import type { ActionResult } from "@/lib/action-result";
import { apiPost } from "@/lib/api/server";

/** POST /v1/devices/:id/ask — the device chat. Gateway binds tenant and device (PORTAL.md §3). */
export async function askDevice(deviceId: string, text: string): Promise<ActionResult<ChatMessage>> {
  const id = Id.safeParse(deviceId);
  const parsed = AskRequest.safeParse({ text });
  if (!id.success || !parsed.success) return { ok: false, message: "Ask a question to send." };

  try {
    const { message } = await apiPost(routes.devices.ask.path(id.data), AskResponse, parsed.data);
    return { ok: true, data: message };
  } catch (error) {
    return actionFailure("askDevice", error, "I can’t reach the service right now. Try again in a moment.");
  }
}
