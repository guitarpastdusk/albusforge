"use client";

import type { Accent, DeviceAction, DeviceActionKind } from "@albusforge/schema";
import { useState } from "react";
import { Button, Toggle } from "@/components/ui";
import { accentClasses } from "@/lib/accent";
import { cx } from "@/lib/cx";
import { CardLabel } from "./DeviceWidgets";

const KIND_ACCENT: Record<DeviceActionKind, Accent> = { SERVO: "green", API: "blue", ALERT: "peach" };

/**
 * "Closed loop · actions": the rules this device acts on.
 *
 * TODO(api): toggles are optimistic local state only. There is no route to
 * enable or disable an action (or create one — "+ New action") yet; PORTAL.md
 * §3 needs one before these can persist.
 */
export function ClosedLoopActions({ actions, lastAction }: { actions: DeviceAction[]; lastAction: string | null }) {
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(actions.map((action) => [action.id, action.enabled])),
  );

  return (
    <section className="rounded-[24px] border border-hairline bg-white px-8 py-[26px]">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <CardLabel>Closed loop · actions</CardLabel>
        {lastAction ? <span className="font-mono text-[12px] text-faint">last action: {lastAction}</span> : null}
      </div>

      <ul className="mt-[18px] flex flex-col gap-3">
        {actions.map((action) => {
          const on = enabled[action.id] ?? action.enabled;
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
                onChange={() => setEnabled((current) => ({ ...current, [action.id]: !on }))}
              />
            </li>
          );
        })}
      </ul>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-hairline pt-4">
        <span className="text-[14px] font-light text-muted">
          Add a rule in plain words — &quot;water for 5 min when soil drops below 22%&quot;.
        </span>
        {/* TODO(api): opens the rule composer once there is a route to create an action. */}
        <Button variant="dark" className="rounded-xl px-5 py-2.5 text-[14px] font-medium">
          + New action
        </Button>
      </div>
    </section>
  );
}
