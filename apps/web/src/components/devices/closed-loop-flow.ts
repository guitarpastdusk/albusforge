import type { ActionProposal, DeviceAction } from "@albusforge/schema";
import type { WriteResult } from "@/actions/device-actions";
import { settle } from "@/lib/safe-action";

/*
 * Pure state for the rules card (ADR 0010). The server's snapshot is the
 * truth; the card layers per-rule local knowledge over it and the snapshot
 * retires what it supersedes. Nothing here touches React or the network.
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
 * What the card knows about one rule beyond the snapshot.
 * - `confirmed`: the last response the server accepted for this rule. Shown
 *   instead of the snapshot's copy until a snapshot supersedes it (same or
 *   higher `version`, or any newer snapshot when versions are absent).
 * - `attempt`: the write in flight (`writing`, switch flipped on screen) or one
 *   whose outcome is unknown (`unknown`, the confirmed/server copy shown with an
 *   "unconfirmed" badge). A refusal removes only the attempt; `confirmed` stays.
 */
export interface Override {
  /** The accepted response and the snapshot generation it is known to be newer than. */
  confirmed?: { action: DeviceAction; generation: number };
  attempt?: { action: DeviceAction; state: "writing" | "unknown" };
}

export interface LocalRules {
  overrides: Record<string, Override>;
  /** Rules created here that the snapshot doesn't carry yet. */
  added: DeviceAction[];
  /** Counts snapshots seen; lets an unversioned response be ordered against the snapshot it followed. */
  generation: number;
}

export const NO_LOCAL_RULES: LocalRules = { overrides: {}, added: [], generation: 0 };

export type RowStatus = "writing" | "unknown" | "written" | null;

export interface RuleRow {
  action: DeviceAction;
  status: RowStatus;
}

/**
 * Whether the snapshot's copy is at least as new as a response the server
 * gave us. With versions on both sides, same or higher wins. Without them, a
 * snapshot supersedes the response only if it arrived after it (a later
 * generation); the snapshot the response followed never does.
 */
export function supersedes(server: DeviceAction | undefined, confirmed: NonNullable<Override["confirmed"]>, generation: number): boolean {
  if (!server) return false;
  if (server.version !== undefined && confirmed.action.version !== undefined) return server.version >= confirmed.action.version;
  return generation > confirmed.generation;
}

function resolve(server: DeviceAction | undefined, override: Override | undefined, fallback: DeviceAction, generation: number): RuleRow {
  const confirmed = override?.confirmed;
  const base = confirmed && !supersedes(server, confirmed, generation) ? confirmed.action : (server ?? fallback);
  const attempt = override?.attempt;
  if (attempt?.state === "writing") return { action: attempt.action, status: "writing" };
  if (attempt?.state === "unknown") return { action: base, status: "unknown" };
  return { action: base, status: base === confirmed?.action ? "written" : null };
}

/** The rows to render: the snapshot with local knowledge applied, then local additions. Supersession is checked here, on every render. */
export function mergeRules(server: readonly DeviceAction[], local: LocalRules): RuleRow[] {
  const rows = server.map((action) => resolve(action, local.overrides[action.id], action, local.generation));
  const seen = new Set(server.map((a) => a.id));
  for (const action of local.added) if (!seen.has(action.id)) rows.push(resolve(undefined, local.overrides[action.id], action, local.generation));
  return rows;
}

/**
 * A fresh snapshot arrived: drop what it answers. Confirmed responses it
 * supersedes, unknown attempts (the snapshot is the answer), and additions it
 * now carries. Writes in flight keep their optimistic state.
 */
export function reconcile(server: readonly DeviceAction[], local: LocalRules): LocalRules {
  const generation = local.generation + 1;
  const byId = new Map(server.map((a) => [a.id, a]));
  const overrides: Record<string, Override> = {};
  for (const [id, override] of Object.entries(local.overrides)) {
    const next: Override = {};
    if (override.confirmed && !supersedes(byId.get(id), override.confirmed, generation)) next.confirmed = override.confirmed;
    if (override.attempt?.state === "writing") next.attempt = override.attempt;
    if (next.confirmed || next.attempt) overrides[id] = next;
  }
  return { overrides, added: local.added.filter((a) => !byId.has(a.id)), generation };
}

/** The switch flipped; the write is in flight. */
export function startWrite(local: LocalRules, action: DeviceAction): LocalRules {
  return patch(local, action.id, (o) => ({ ...o, attempt: { action, state: "writing" } }));
}

/**
 * The server accepted the write. `current` is the snapshot's copy of the rule
 * at settlement and `generationAtStart` the generation when the write began:
 * a snapshot that changed meanwhile and already supersedes the response wins,
 * so a late response can't undo newer server state. Otherwise the response
 * is kept as the baseline, known newer than the snapshot generation it was
 * settled against.
 */
export function finishWrite(local: LocalRules, data: DeviceAction, current: DeviceAction | undefined, generationAtStart: number): LocalRules {
  const settled = { action: data, generation: generationAtStart };
  const stale = local.generation !== generationAtStart && supersedes(current, settled, local.generation);
  return patch(local, data.id, (o) => {
    const next: Override = {};
    if (!stale) next.confirmed = { action: data, generation: local.generation };
    else if (o.confirmed && !supersedes(current, o.confirmed, local.generation)) next.confirmed = o.confirmed;
    return next;
  });
}

/** The server refused: only the attempt goes; an earlier accepted response stays. */
export function refuseWrite(local: LocalRules, id: string): LocalRules {
  return patch(local, id, ({ confirmed }) => (confirmed ? { confirmed } : {}));
}

/** The outcome is unknown: keep what we knew, mark the rule unconfirmed until a snapshot answers. */
export function loseWrite(local: LocalRules, action: DeviceAction): LocalRules {
  return patch(local, action.id, (o) => ({ ...o, attempt: { action, state: "unknown" } }));
}

export function withAdded(local: LocalRules, action: DeviceAction): LocalRules {
  return { ...local, added: [...local.added.filter((a) => a.id !== action.id), action] };
}

function patch(local: LocalRules, id: string, update: (current: Override) => Override): LocalRules {
  const overrides = { ...local.overrides };
  const next = update(overrides[id] ?? {});
  if (next.confirmed || next.attempt) overrides[id] = next;
  else delete overrides[id];
  return { ...local, overrides };
}
