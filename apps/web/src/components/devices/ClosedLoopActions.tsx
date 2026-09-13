"use client";

import type { Accent, ActionProposal, DeviceAction, DeviceActionKind } from "@albusforge/schema";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { confirmAction, proposeAction, setActionEnabled } from "@/actions/device-actions";
import { Button, Toggle } from "@/components/ui";
import { accentClasses } from "@/lib/accent";
import { cx } from "@/lib/cx";
import { finishWrite, loseWrite, mergeRules, NO_LOCAL_RULES, reconcile, refuseWrite, startWrite, withAdded, writeOnce, type RuleRow } from "./closed-loop-flow";
import { CardLabel } from "./DeviceWidgets";

const KIND_ACCENT: Record<DeviceActionKind, Accent> = { SERVO: "green", API: "blue", ALERT: "peach" };

export const READ_ONLY_NOTE = "You can see the rules this device runs. Changing them needs an operator on this tenant.";
export const PENDING_LABEL = "applies at next check-in";
export const UNCONFIRMED_LABEL = "unconfirmed · refreshing";

/**
 * "Closed loop · actions": the rules this device acts on, and where a person
 * changes them (PORTAL.md §3, ADR 0010).
 *
 * The server's snapshot (`actions`) is the truth. Per rule, the card keeps
 * the last response the server accepted and the attempt in flight, layered
 * over the snapshot; a snapshot that is as new or newer wins, checked on
 * every render, so a late response can't undo newer server state and a
 * refused second click can't erase an accepted first one (closed-loop-flow.ts):
 * - A switch flips on screen at once and is written through a Server
 *   Function. A refusal (not built, wrong role) puts it back and says why.
 *   An outcome we can't confirm (lost response) shows the server's copy with
 *   an "unconfirmed" badge and refreshes the page, so the switch never
 *   claims a state the device may not have.
 * - A rule the device hasn't acknowledged is marked "applies at next
 *   check-in" (`sync: "pending"`): changes ride back on the device's next
 *   post (CLOUD-PLATFORM.md §3.4). The badge clears when a snapshot says
 *   `synced`.
 * - A new rule is plain words, read back as a proposal, and only created
 *   when the person confirms the reading. Confirming is idempotent, so a
 *   retry after a lost response is safe and never makes a second rule.
 *
 * `canEdit` is the dashboard's `permissions.edit_actions`; without it the
 * card is read-only and says so. The page keys the card by device id, so a
 * different device starts from a clean state.
 */
export function ClosedLoopActions({
  deviceId,
  actions: snapshot,
  lastAction,
  canEdit,
}: {
  deviceId: string;
  actions: DeviceAction[];
  lastAction: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [local, setLocal] = useState(NO_LOCAL_RULES);
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const noteId = useId();

  // A fresh snapshot answers unknown outcomes and retires completed writes.
  // Adjusted during render (React's pattern for state that follows a prop).
  const [seen, setSeen] = useState(snapshot);
  if (seen !== snapshot) {
    setSeen(snapshot);
    setLocal(reconcile(snapshot, local));
  }
  // The snapshot as of the latest render, read by a write that settles after a refresh.
  const latest = useRef(snapshot);
  useEffect(() => {
    latest.current = snapshot;
  }, [snapshot]);

  const rows = mergeRules(snapshot, local);

  const toggle = async ({ action, status }: RuleRow) => {
    if (!canEdit || status === "writing" || status === "unknown") return;
    const next = !action.enabled;
    const generationAtStart = local.generation;
    setError(null);
    setLocal((current) => startWrite(current, { ...action, enabled: next }));
    const outcome = await writeOnce(() => setActionEnabled(deviceId, action.id, next));
    if (outcome.ok) {
      const current = latest.current.find((a) => a.id === action.id);
      setLocal((state) => finishWrite(state, outcome.data, current, generationAtStart));
      return;
    }
    setError(outcome.message);
    if (outcome.outcome === "refused") {
      setLocal((current) => refuseWrite(current, action.id));
    } else {
      setLocal((current) => loseWrite(current, action));
      router.refresh();
    }
  };

  return (
    <section className="rounded-[24px] border border-hairline bg-white px-8 py-[26px]" aria-labelledby={`${noteId}-title`}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <span id={`${noteId}-title`}>
            <CardLabel>Closed loop · actions</CardLabel>
          </span>
          {canEdit ? null : <Badge>Read-only</Badge>}
        </div>
        {lastAction ? <span className="font-mono text-[12px] text-faint">last action: {lastAction}</span> : null}
      </div>

      {rows.length === 0 ? (
        <p className="mt-[18px] text-[15px] font-light text-muted">
          No rules yet. {canEdit ? "The device reports; nothing acts on its readings until you add one." : ""}
        </p>
      ) : (
        <ul className="mt-[18px] flex flex-col gap-3">
          {rows.map((row) => {
            const { action, status } = row;
            const { bg, fg } = accentClasses[KIND_ACCENT[action.kind]];
            const locked = !canEdit || status === "writing" || status === "unknown";
            return (
              <li key={action.id} className="flex items-center gap-4 rounded-2xl border border-hairline px-5 py-4" data-status={status ?? undefined}>
                <span className={cx("flex-none whitespace-nowrap rounded-full px-3.5 py-1.5 font-mono text-[12px]", bg, fg)}>{action.kind}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-medium text-ink">{action.rule}</span>
                    {status === "unknown" ? (
                      <Badge tone="pending">{UNCONFIRMED_LABEL}</Badge>
                    ) : action.sync === "pending" ? (
                      <Badge tone="pending">{PENDING_LABEL}</Badge>
                    ) : null}
                  </div>
                  <div className="mt-0.5 text-[13px] font-light text-muted">{action.via}</div>
                </div>
                <Toggle
                  checked={action.enabled}
                  label={action.rule}
                  disabled={locked}
                  describedBy={canEdit ? undefined : noteId}
                  onChange={() => void toggle(row)}
                />
              </li>
            );
          })}
        </ul>
      )}

      {error ? (
        <p role="alert" className="mt-3 text-[14px] text-coral">
          {error}
        </p>
      ) : null}

      {composing && canEdit ? (
        <RuleComposer
          deviceId={deviceId}
          onCreated={(action) => {
            setLocal((current) => withAdded(current, action));
            setComposing(false);
          }}
          onCancel={() => setComposing(false)}
        />
      ) : (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-hairline pt-4">
          <span id={noteId} className="text-[14px] font-light text-muted">
            {canEdit ? "Add a rule in plain words — “water for 5 min when soil drops below 22%”. You confirm how it's read before it runs." : READ_ONLY_NOTE}
          </span>
          <Button
            variant="dark"
            disabled={!canEdit}
            aria-describedby={canEdit ? undefined : noteId}
            onClick={() => setComposing(true)}
            className="rounded-xl px-5 py-2.5 text-[14px] font-medium"
          >
            + New action
          </Button>
        </div>
      )}
    </section>
  );
}

function Badge({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "pending" }) {
  return (
    <span
      className={cx(
        "rounded-full border px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-[0.12em]",
        tone === "pending" ? "border-coral/40 text-coral-deep" : "border-hairline text-muted",
      )}
    >
      {children}
    </span>
  );
}

/**
 * Plain words → proposal → confirm. Two steps on purpose: the person confirms
 * the service's reading of the rule (normalized condition, what it does, any
 * issues), not the words they typed. A proposal with issues can't be
 * confirmed. A confirmation whose outcome is unknown keeps the proposal, since
 * confirming the same proposal again returns the rule it already created.
 */
export function RuleComposer({
  deviceId,
  onCreated,
  onCancel,
}: {
  deviceId: string;
  onCreated: (action: DeviceAction) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const [proposal, setProposal] = useState<ActionProposal | null>(null);
  const [pending, setPending] = useState<"propose" | "confirm" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();

  const propose = async (value: string) => {
    const words = value.trim();
    if (!words || pending) return;
    setError(null);
    setPending("propose");
    const outcome = await writeOnce(() => proposeAction(deviceId, words));
    if (outcome.ok) setProposal(outcome.data);
    else setError(outcome.message);
    setPending(null);
  };

  const confirm = async () => {
    if (!proposal || pending) return;
    setError(null);
    setPending("confirm");
    const outcome = await writeOnce(() => confirmAction(deviceId, proposal.id));
    if (outcome.ok) {
      onCreated(outcome.data);
      return;
    }
    setError(outcome.message);
    // Refused (expired, spent by someone else, issues): the proposal is no good; keep the words.
    // Unknown: keep the proposal, so the retry hits the same id and can't create a second rule.
    if (outcome.outcome === "refused") setProposal(null);
    setPending(null);
  };

  return (
    <div className="mt-4 border-t border-hairline pt-4" aria-label="New action">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void propose(String(new FormData(event.currentTarget).get("rule") ?? ""));
        }}
        className="flex flex-wrap items-center gap-2.5"
      >
        <label htmlFor={inputId} className="sr-only">
          Describe the rule
        </label>
        <input
          id={inputId}
          name="rule"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            if (proposal) setProposal(null);
          }}
          placeholder="water for 5 min when soil drops below 22%"
          autoFocus
          className="min-w-0 flex-1 rounded-xl border border-hairline px-4 py-2.5 text-[15px] text-ink outline-none focus:border-ink"
        />
        <Button type="submit" variant="dark" disabled={pending !== null || !text.trim()} className="rounded-xl px-5 py-2.5 text-[14px] font-medium">
          {pending === "propose" ? "Reading…" : "Propose"}
        </Button>
        <Button type="button" variant="dark" onClick={onCancel} className="rounded-xl bg-transparent px-4 py-2.5 text-[14px] font-medium text-muted hover:bg-hairline hover:text-ink">
          Cancel
        </Button>
      </form>

      {proposal ? <ProposalCard proposal={proposal} pending={pending === "confirm"} onConfirm={() => void confirm()} /> : null}

      {error ? (
        <p role="alert" className="mt-3 text-[14px] text-coral">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function ProposalCard({ proposal, pending, onConfirm }: { proposal: ActionProposal; pending: boolean; onConfirm: () => void }) {
  const { bg, fg } = accentClasses[KIND_ACCENT[proposal.kind]];
  const blocked = proposal.issues.length > 0;
  return (
    <div className="mt-3 rounded-2xl border border-dashed border-hairline px-5 py-4" data-testid="proposal">
      <div className="flex flex-wrap items-center gap-3">
        <span className={cx("flex-none whitespace-nowrap rounded-full px-3.5 py-1.5 font-mono text-[12px]", bg, fg)}>{proposal.kind}</span>
        <span className="text-[15px] font-medium text-ink">{proposal.rule}</span>
      </div>
      <p className="mt-2 text-[14px] font-light text-muted">{proposal.summary}</p>
      {blocked ? (
        <ul className="mt-2 flex flex-col gap-1 text-[14px] text-coral-deep">
          {proposal.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-[13px] font-light text-faint">{proposal.via}</p>
      )}
      <div className="mt-3 flex items-center gap-3">
        <Button variant="coral" disabled={blocked || pending} onClick={onConfirm} className="rounded-xl px-5 py-2.5 text-[14px] font-semibold">
          {pending ? "Confirming…" : "Confirm rule"}
        </Button>
        <span className="text-[13px] font-light text-muted">{blocked ? "Edit the words above and propose again." : "Runs once the device checks in."}</span>
      </div>
    </div>
  );
}
