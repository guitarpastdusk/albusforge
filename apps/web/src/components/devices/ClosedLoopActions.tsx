"use client";

import type { Accent, DeviceAction, DeviceActionKind } from "@albusforge/schema";
import { useId, useState } from "react";
import { Button, Toggle } from "@/components/ui";
import { accentClasses } from "@/lib/accent";
import { cx } from "@/lib/cx";
import { CardLabel } from "./DeviceWidgets";

const KIND_ACCENT: Record<DeviceActionKind, Accent> = { SERVO: "green", API: "blue", ALERT: "peach" };

/**
 * "Closed loop · actions": the rules this device acts on.
 *
 * `interactive` is true only in mock mode, where toggling is a local
 * simulation. In live mode the card is read-only and says so: a switch that
 * changes on screen without reaching the device would misstate what an
 * irrigation valve or an alert is doing.
 *
 * TODO(api): once gateway has an authenticated route to enable/disable and
 * create actions (PORTAL.md §3), make live toggles call it through a Server
 * Function, apply the change optimistically, and roll it back if the call
 * fails or is refused.
 */
export function ClosedLoopActions({
  actions,
  lastAction,
  interactive,
}: {
  actions: DeviceAction[];
  lastAction: string | null;
  interactive: boolean;
}) {
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(actions.map((action) => [action.id, action.enabled])),
  );
  const noteId = useId();

  return (
    <section className="rounded-[24px] border border-hairline bg-white px-8 py-[26px]">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <CardLabel>Closed loop · actions</CardLabel>
          {interactive ? null : (
            <span className="rounded-full border border-hairline px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
              Not connected yet
            </span>
          )}
        </div>
        {lastAction ? <span className="font-mono text-[12px] text-faint">last action: {lastAction}</span> : null}
      </div>

      <ul className="mt-[18px] flex flex-col gap-3">
        {actions.map((action) => {
          const on = interactive ? (enabled[action.id] ?? action.enabled) : action.enabled;
          const { bg, fg } = accentClasses[KIND_ACCENT[action.kind]];
          return (
            <li key={action.id} className="flex items-center gap-4 rounded-2xl border border-hairline px-5 py-4">
              <span className={cx("flex-none whitespace-nowrap rounded-full px-3.5 py-1.5 font-mono text-[12px]", bg, fg)}>
                {action.kind}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-medium text-ink">{action.rule}</div>
                <div className="mt-0.5 text-[13px] font-light text-muted">{action.via}</div>
              </div>
              <Toggle
                checked={on}
                label={action.rule}
                disabled={!interactive}
                describedBy={interactive ? undefined : noteId}
                onChange={() => setEnabled((current) => ({ ...current, [action.id]: !on }))}
              />
            </li>
          );
        })}
      </ul>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-hairline pt-4">
        {interactive ? (
          <span className="text-[14px] font-light text-muted">
            Add a rule in plain words — &quot;water for 5 min when soil drops below 22%&quot;.
          </span>
        ) : (
          <span id={noteId} className="text-[14px] font-light text-muted">
            Changing rules from the portal isn’t connected yet — these are the rules the device runs now.
          </span>
        )}
        <Button
          variant="dark"
          disabled={!interactive}
          aria-describedby={interactive ? undefined : noteId}
          className="rounded-xl px-5 py-2.5 text-[14px] font-medium"
        >
          + New action
        </Button>
      </div>
    </section>
  );
}
