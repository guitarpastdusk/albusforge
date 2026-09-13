import type { ChatMessage } from "@albusforge/schema";
import type { ActionResult } from "@/lib/action-result";
import { settle } from "@/lib/safe-action";

export type AskOutcome = { ok: true; reply: string } | { ok: false; message: string };

/** One device question, settled: never rejects, so the panel always leaves its pending state. */
export async function askOnce(ask: () => Promise<ActionResult<ChatMessage>>): Promise<AskOutcome> {
  const result = await settle(ask);
  return result.ok ? { ok: true, reply: result.data.text } : { ok: false, message: result.message };
}
