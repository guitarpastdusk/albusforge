import { Fleet, Me, routes } from "@albusforge/schema";
import type { Metadata } from "next";
import Link from "next/link";
import { PageContainer, PageTitle, PulseDot } from "@/components/ui";
import { accentClasses } from "@/lib/accent";
import { apiGet } from "@/lib/api/server";
import { cx } from "@/lib/cx";
import { AWAITING_FIRST_READING, deviceState, formatAgo, formatCompact, pluralize } from "@/lib/format";

export const metadata: Metadata = { title: "Live systems" };

export default async function LiveSystemsPage() {
  const me = await apiGet(routes.me.get.path(), Me);
  const fleet = await apiGet(routes.tenants.devices.path(me.tenant.id), Fleet);
  const now = new Date();

  // A device awaiting its first reading isn't offline — it hasn't been switched on yet.
  const offline = fleet.systems.flatMap((s) => s.devices).filter((d) => deviceState(d) === "offline").length;

  return (
    <PageContainer>
      <PageTitle
        kicker={offline === 0 ? "Fleet · all healthy" : `Fleet · ${pluralize(offline, "device")} offline`}
        kickerTone={offline === 0 ? "success" : "coral"}
        title="Live systems"
        actions={
          <div className="flex gap-[26px] font-mono text-[15px] text-muted">
            <span>
              <b className="text-[22px] font-medium text-ink">{fleet.stats.device_count}</b> devices
            </span>
            <span>
              <b className="text-[22px] font-medium text-ink">{formatCompact(fleet.stats.readings_per_day)}</b>{" "}
              readings/day
            </span>
            <span>
              <b className="text-[22px] font-medium text-success">{Math.round(fleet.stats.online_ratio * 100)}%</b>{" "}
              online
            </span>
          </div>
        }
      />

      {/* Stub: proves the data path. Live values arrive over SSE (/v1/tenants/:id/stream) later. */}
      <div className="mt-9 flex flex-col gap-7">
        {fleet.systems.map((system) => (
          <section key={system.build_id} className="rounded-[26px] border border-hairline bg-white px-[34px] py-[30px]">
            <div className="flex flex-wrap items-baseline justify-between gap-5">
              <h2 className="font-display text-[28px] font-medium">{system.name}</h2>
              <span className="font-mono text-[14px] text-muted">{system.location}</span>
            </div>
            <ul className="mt-[22px] grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-4">
              {system.devices.map((device) => {
                const { bg, fg } = accentClasses[device.accent];
                const state = deviceState(device);
                return (
                  <li key={device.id}>
                    <Link
                      href={`/live/${encodeURIComponent(device.id)}`}
                      className={cx("flex flex-col gap-2 rounded-[18px] px-6 py-5 hover:shadow-tile", bg, fg)}
                    >
                      <span className="flex items-center gap-2 text-[15px] font-semibold">
                        {state === "online" ? <PulseDot size={9} /> : null}
                        {device.name}
                      </span>
                      {device.last_reading_at === null ? (
                        <>
                          <span className="font-mono text-[15px] leading-[29px]">{AWAITING_FIRST_READING}</span>
                          <span className="text-[13px] opacity-75">{device.metric}</span>
                        </>
                      ) : (
                        <>
                          <span className="font-mono text-[24px]">
                            {device.value ?? "—"}
                            {device.unit ? <span className="text-[15px] opacity-70"> {device.unit}</span> : null}
                          </span>
                          <span className="text-[13px] opacity-75">
                            {device.metric} · {formatAgo(device.last_reading_at, now)}
                          </span>
                        </>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </PageContainer>
  );
}
