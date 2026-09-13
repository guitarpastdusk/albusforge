"use client";

import type { DeviceDashboard } from "@albusforge/schema";
import { useState, type ReactNode } from "react";
import { DeviceStatusHeader } from "@/components/devices/DeviceStatusHeader";
import { DeviceWidgets } from "@/components/devices/DeviceWidgets";
import { Pill } from "@/components/ui";
import { mergeDashboardSnapshot, applyReadingToDashboard, applyStatusToDashboard } from "@/lib/live/live-dashboard";
import { useLiveStream } from "@/lib/live/useLiveStream";
import { useNow } from "@/lib/live/useNow";
import { LiveConnection } from "./LiveConnection";

/**
 * The device dashboard's live part: status line, chips and widgets, updated
 * from the tenant stream scoped to this device. `below` (the rules card) and
 * `aside` (the chat) are server-rendered and passed through, so they keep
 * their own state and Server Functions.
 */
export function LiveDashboard({
  tenantId,
  dashboard: snapshot,
  initialNow,
  below,
  aside,
}: {
  tenantId: string;
  dashboard: DeviceDashboard;
  initialNow: string;
  below?: ReactNode;
  aside: ReactNode;
}) {
  const [dashboard, setDashboard] = useState(snapshot);
  const [seen, setSeen] = useState(snapshot);
  if (seen !== snapshot) {
    setSeen(snapshot);
    setDashboard(mergeDashboardSnapshot(snapshot, dashboard));
  }
  const now = useNow(new Date(initialNow));
  const connection = useLiveStream(tenantId, [dashboard.device.id], {
    onReading: (event) => setDashboard((current) => applyReadingToDashboard(current, event)),
    onStatus: (event) => setDashboard((current) => applyStatusToDashboard(current, event)),
  });
  const { device } = dashboard;

  return (
    <>
      <div className="mt-[18px] flex flex-wrap items-end justify-between gap-6">
        <DeviceStatusHeader device={device} now={now} live={connection.state === "open"} />
        <ul className="flex flex-wrap gap-2">
          {device.chips.map((chip) => (
            <li key={chip.label}>
              <Pill accent={chip.accent} className="px-[18px] py-2 text-[14px]">
                {chip.label}
              </Pill>
            </li>
          ))}
        </ul>
      </div>

      <LiveConnection {...connection} />
      <p className="mt-2 text-xs text-muted">Current values update live. Historical averages update on refresh.</p>

      <div className="mt-[30px] grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <DeviceWidgets dashboard={dashboard} />
          {below}
        </div>
        {aside}
      </div>
    </>
  );
}
