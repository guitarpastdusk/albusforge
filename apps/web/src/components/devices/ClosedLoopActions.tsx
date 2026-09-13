"use client";

import type { Accent, ActionProposal, DeviceAction, DeviceActionKind } from "@albusforge/schema";
import { useId, useState } from "react";
import { confirmAction, proposeAction, setActionEnabled } from "@/actions/device-actions";
import { Button, Toggle } from "@/components/ui";
import { accentClasses } from "@/lib/accent";
import { cx } from "@/lib/cx";
import { upsertAction, withEnabled, writeOnce } from "./closed-loop-flow";
import { CardLabel } from "./DeviceWidgets";

const KIND_ACCENT: Record<DeviceActionKind, Accent> = { SERVO: "green", API: "blue", ALERT: "peach" };

export const READ_ONLY_NOTE = "You can see the rules this device runs. Changing them needs an operator on this tenant.";
export const PENDING_LABEL = "applies at next check-in";

/**
 * "Closed loop · actions": the rules this device acts on, and where a person
 * changes them (PORTAL.md §3, ADR 0010).
 *
 * - A switch flips on screen at once and is written through a Server
 *   Function. If the write fails or is refused the switch goes back and the
 *   card says why: a switch that stays changed without reaching the device
 *   would misstate what a valve or an alert is doing.
 * - A rule the device hasn't acknowledged yet is marked "applies at next
 *   check-in" (`sync: "pending"`): changes ride back on the device's next
 *   post (CLOUD-PLATFORM.md §3.4), minutes, not milliseconds.
 * - A new rule is written in plain words, read back as a proposal, and only
 *   created when the person confirms the reading. The composer never writes
 *   a rule directly.
 *
 * `canEdit` is the dashboard's `permissions.edit_actions` — operator or admin
 * on the device's tenant. Without it the card is read-only and says so.
 */
export function ClosedLoopActions({
  deviceId,
  actions: initial,
  lastAction,
  canEdit,
}: {
  deviceId: string;
  actions: DeviceAction[];
  lastAction: string | null;
  canEdit: boolean;
}) {
  const [actions, setActions] = useState(initial);
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const noteId = useId();

  const toggle = async (action: DeviceAction) => {
    if (!canEdit || busy.has(action.id)) return;
    const next = !action.enabled;
    setError(null);
    setBusy((current) => new Set(current).add(action.id));
    setActions((current) => withEnabled(current, action.id, next));
    const outcome = await writeOnce(() => setActionEnabled(deviceId, action.id, next));
    setActions((current) => (outcome.ok ? upsertAction(current, outcome.data) : withEnabled(current, action.id, action.enabled)));
    if (!outcome.ok) setError(outcome.message);
    setBusy((current) => {
      const copy = new Set(current);
      copy.delete(action.id);
      return copy;
    });
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

      {actions.length === 0 ? (
        <p className="mt-[18px] text-[15px] font-light text-muted">
          No rules yet. {canEdit ? "The device reports; nothing acts on its readings until you add one." : ""}
        </p>
      ) : (
        <ul className="mt-[18px] flex flex-col gap-3">
          {actions.map((action) => {
            const { bg, fg } = accentClasses[KIND_ACCENT[action.kind]];
            const pending = action.sync === "pending";
            return (
              <li key={action.id} className="flex items-center gap-4 rounded-2xl border border-hairline px-5 py-4">
                <span className={cx("flex-none whitespace-nowrap rounded-full px-3.5 py-1.5 font-mono text-[12px]", bg, fg)}>{action.kind}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-medium text-ink">{action.rule}</span>
                    {pending ? <Badge tone="pending">{PENDING_LABEL}</Badge> : null}
                  </div>
                  <div className="mt-0.5 text-[13px] font-light text-muted">{action.via}</div>
                </div>
                <Toggle
                  checked={action.enabled}
                  label={action.rule}
                  disabled={!canEdit || busy.has(action.id)}
                  describedBy={canEdit ? undefined : noteId}
                  onChange={() => void toggle(action)}
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
            setActions((current) => upsertAction(current, action));
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
 * issues), not the words they typed. A proposal with issues can't be confirmed.
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
    if (outcome.ok) onCreated(outcome.data);
    else {
      setError(outcome.message);
      // An expired proposal has to be re-read; keep the words so it's one click.
      if (/expired|gone/i.test(outcome.message)) setProposal(null);
    }
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
