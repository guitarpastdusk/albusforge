import { Fleet, routes } from "@albusforge/schema";
import type { Metadata } from "next";
import Link from "next/link";
import { DeviceTileBody } from "@/components/devices/DeviceTileBody";
import { PageContainer, PageTitle } from "@/components/ui";
import { accentClasses } from "@/lib/accent";
import { apiGet } from "@/lib/api/server";
import { cx } from "@/lib/cx";
import { formatCompact, pluralize } from "@/lib/format";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Live systems" };

export default async function LiveSystemsPage() {
  // The session is GET /v1/me: its active tenant scopes the fleet.
  const me = await requireSession("/live");
  const fleet = await apiGet(routes.tenants.devices.path(me.tenant.id), Fleet);
  const now = new Date();

  // A never-seen device isn't offline — it hasn't been switched on yet.
  const offline = fleet.systems.flatMap((s) => s.devices).filter((d) => d.status === "offline").length;

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

      {/* TODO: live values arrive over SSE (/v1/tenants/:id/stream); today they refresh per request. */}
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
    </PageContainer>
  );
}
