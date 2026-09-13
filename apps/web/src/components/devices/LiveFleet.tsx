"use client";

import type { Fleet } from "@albusforge/schema";
import Link from "next/link";
import { useState } from "react";
import { DeviceTileBody } from "@/components/devices/DeviceTileBody";
import { PageTitle } from "@/components/ui";
import { accentClasses } from "@/lib/accent";
import { cx } from "@/lib/cx";
import { formatCompact, pluralize } from "@/lib/format";
import { applyReadingToFleet, applyStatusToFleet } from "@/lib/live/live-fleet";
import { useLiveStream } from "@/lib/live/useLiveStream";
import { useNow } from "@/lib/live/useNow";

/**
 * The Live systems screen with live values. The server-rendered fleet is
 * the starting point; readings and status changes from the tenant stream are
 * applied on top, and ages tick. A fresh server snapshot (a refresh) replaces
 * the whole thing, since the page is keyed by tenant.
 */
export function LiveFleet({ tenantId, fleet: snapshot, initialNow }: { tenantId: string; fleet: Fleet; initialNow: string }) {
  const [fleet, setFleet] = useState(snapshot);
  const [seen, setSeen] = useState(snapshot);
  if (seen !== snapshot) {
    setSeen(snapshot);
    setFleet(snapshot);
  }
  const now = useNow(new Date(initialNow));
  const deviceIds = fleet.systems.flatMap((s) => s.devices.map((d) => d.id));
  const live = useLiveStream(tenantId, deviceIds, {
    onReading: (event) => setFleet((current) => applyReadingToFleet(current, event)),
    onStatus: (event) => setFleet((current) => applyStatusToFleet(current, event)),
  });

  // A never-seen device isn't offline — it hasn't been switched on yet.
  const offline = fleet.systems.flatMap((s) => s.devices).filter((d) => d.status === "offline").length;
  const kicker = offline === 0 ? "Fleet · all healthy" : `Fleet · ${pluralize(offline, "device")} offline`;

  return (
    <>
      <PageTitle
        kicker={live ? `${kicker} · live` : kicker}
        kickerTone={offline === 0 ? "success" : "coral"}
        title="Live systems"
        actions={
          <div className="flex gap-[26px] font-mono text-[15px] text-muted">
            <span>
              <b className="text-[22px] font-medium text-ink">{fleet.stats.device_count}</b> devices
            </span>
            <span>
              <b className="text-[22px] font-medium text-ink">{formatCompact(fleet.stats.readings_per_day)}</b> readings/day
            </span>
            <span>
              <b className="text-[22px] font-medium text-success">{Math.round(fleet.stats.online_ratio * 100)}%</b> online
            </span>
          </div>
        }
      />

      <div className="mt-9 flex flex-col gap-7" aria-live="polite" aria-atomic="false">
        {fleet.systems.map((system) => (
          <section key={system.build_id} className="rounded-[26px] border border-hairline bg-white px-6 py-6 sm:px-[34px] sm:py-[30px]">
            <div className="flex flex-wrap items-baseline justify-between gap-5">
              <h2 className="font-display text-[28px] font-medium">{system.name}</h2>
              <span className="font-mono text-[14px] text-muted">{system.location}</span>
            </div>
            <ul className="mt-[22px] grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-4">
              {system.devices.map((device) => {
                const { bg, fg } = accentClasses[device.accent];
                return (
                  <li key={device.id}>
                    <Link
                      href={`/live/${encodeURIComponent(device.id)}`}
                      className={cx("flex flex-col gap-2 rounded-[18px] px-6 py-5 hover:shadow-tile", bg, fg)}
                    >
                      <DeviceTileBody device={device} now={now} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
