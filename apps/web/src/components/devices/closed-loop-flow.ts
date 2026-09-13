import type { ActionProposal, DeviceAction } from "@albusforge/schema";
import type { ActionResult } from "@/lib/action-result";
import { settle } from "@/lib/safe-action";

export type WriteOutcome<T> = { ok: true; data: T } | { ok: false; message: string };

/** One rule write, settled: never rejects, so the card always leaves its pending state and can roll back. */
export async function writeOnce<T extends DeviceAction | ActionProposal>(write: () => Promise<ActionResult<T>>): Promise<WriteOutcome<T>> {
  const result = await settle(write);
  return result.ok ? { ok: true, data: result.data } : { ok: false, message: result.message };
}

/** Replace a rule in the list by id; append it when it's new. */
export function upsertAction(actions: readonly DeviceAction[], action: DeviceAction): DeviceAction[] {
  const index = actions.findIndex((a) => a.id === action.id);
  if (index === -1) return [...actions, action];
  return actions.map((a, i) => (i === index ? action : a));
}

/** Flip a rule's switch optimistically; the write's response replaces it, or a failure restores it. */
export function withEnabled(actions: readonly DeviceAction[], actionId: string, enabled: boolean): DeviceAction[] {
  return actions.map((a) => (a.id === actionId ? { ...a, enabled } : a));
}
