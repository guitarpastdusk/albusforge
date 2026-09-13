import type { ActionProposal, DeviceAction } from "@albusforge/schema";
import type { WriteResult } from "@/actions/device-actions";
import { settle } from "@/lib/safe-action";

/*
 * Pure state for the rules card (ADR 0010). The server's snapshot is the
 * truth; the card layers per-rule local changes over it and lets the next
 * snapshot retire them. Nothing here touches React or the network.
 */

export type WriteOutcome<T> = { ok: true; data: T } | { ok: false; message: string; outcome: "refused" | "unknown" };

/**
 * One rule write, settled: never rejects, so the card always leaves its busy
 * state. A rejected call (lost connection, interrupted response) is an
 * `unknown` outcome — the write may have been committed — never a refusal.
 */
export async function writeOnce<T extends DeviceAction | ActionProposal>(write: () => Promise<WriteResult<T>>): Promise<WriteOutcome<T>> {
  const result = await settle(write);
  if (result.ok) return { ok: true, data: result.data };
  return { ok: false, message: result.message, outcome: "outcome" in result ? result.outcome : "unknown" };
}

/**
 * A local change to one rule, layered over the server's copy.
 * - `writing`: the switch flipped on screen; the write is in flight.
 * - `written`: the write succeeded and `action` is what the server returned.
 *   Retired by the next snapshot, unless that snapshot is older (a lower
 *   `version`) than what we were told.
 * - `unknown`: the write's outcome is unknown. The server's copy is shown
 *   with an "unconfirmed" badge until a fresh snapshot arrives.
 */
export interface Override {
  action: DeviceAction;
  state: "writing" | "written" | "unknown";
}

export interface LocalRules {
  overrides: Record<string, Override>;
  /** Rules created here that the snapshot doesn't carry yet. */
  added: DeviceAction[];
}

export const NO_LOCAL_RULES: LocalRules = { overrides: {}, added: [] };

export interface RuleRow {
  action: DeviceAction;
  status: Override["state"] | null;
}

/** The rows to render: the snapshot with local changes applied, then local additions. */
export function mergeRules(server: readonly DeviceAction[], local: LocalRules): RuleRow[] {
  const rows: RuleRow[] = server.map((action) => {
    const override = local.overrides[action.id];
    if (!override) return { action, status: null };
    // An unknown outcome shows the server's copy: the switch must not claim a change we can't confirm.
    return override.state === "unknown" ? { action, status: "unknown" } : { action: override.action, status: override.state };
  });
  const seen = new Set(server.map((a) => a.id));
  for (const action of local.added) {
    if (seen.has(action.id)) continue;
    const override = local.overrides[action.id];
    rows.push(override && override.state !== "unknown" ? { action: override.action, status: override.state } : { action, status: override?.state ?? null });
  }
  return rows;
}

/** A snapshot is newer than a completed write unless it carries a lower version for that rule. */
function snapshotSupersedes(server: readonly DeviceAction[], written: DeviceAction): boolean {
  const current = server.find((a) => a.id === written.id);
  if (!current) return false;
  if (current.version !== undefined && written.version !== undefined) return current.version >= written.version;
  return true;
}

/**
 * A fresh snapshot arrived: retire what it supersedes. Writes still in flight
 * keep their optimistic state; unknown outcomes are answered by the snapshot;
 * completed writes are retired unless the snapshot is older; additions the
 * snapshot now carries are dropped.
 */
export function reconcile(server: readonly DeviceAction[], local: LocalRules): LocalRules {
  const overrides: Record<string, Override> = {};
  for (const [id, override] of Object.entries(local.overrides)) {
    if (override.state === "writing") overrides[id] = override;
    else if (override.state === "written" && !snapshotSupersedes(server, override.action)) overrides[id] = override;
  }
  const ids = new Set(server.map((a) => a.id));
  return { overrides, added: local.added.filter((a) => !ids.has(a.id)) };
}

export function withOverride(local: LocalRules, id: string, override: Override | null): LocalRules {
  const overrides = { ...local.overrides };
  if (override) overrides[id] = override;
  else delete overrides[id];
  return { ...local, overrides };
}

export function withAdded(local: LocalRules, action: DeviceAction): LocalRules {
  return { ...local, added: [...local.added.filter((a) => a.id !== action.id), action] };
}
