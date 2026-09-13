"use server";

import { AskRequest, AskResponse, Id, routes, type ChatMessage } from "@albusforge/schema";
import { actionFailure } from "@/lib/action-errors";
import type { ActionResult } from "@/lib/action-result";
import { apiPost } from "@/lib/api/server";

/** POST /v1/devices/:id/ask — the device chat. Gateway binds tenant and device (PORTAL.md §3). Arguments are validated at runtime. */
export async function askDevice(deviceId: unknown, text: unknown): Promise<ActionResult<ChatMessage>> {
  try {
    const id = Id.safeParse(deviceId);
    const parsed = AskRequest.safeParse({ text });
    if (!id.success || !parsed.success) return { ok: false, message: "Ask a question to send." };

    const { message } = await apiPost(routes.devices.ask.path(id.data), AskResponse, parsed.data);
    return { ok: true, data: message };
  } catch (error) {
    return actionFailure("askDevice", error, "I can’t reach the service right now. Try again in a moment.");
  }
}
