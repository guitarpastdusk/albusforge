import { DeviceDashboard, routes, type Channel } from "@albusforge/schema";
import Link from "next/link";
import { DeviceStatusHeader } from "@/components/devices/DeviceStatusHeader";
import { PageContainer, Pill } from "@/components/ui";
import { apiGet, orNotFound } from "@/lib/api/server";
import { AWAITING_FIRST_READING, pluralize } from "@/lib/format";

function formatLatest(channel: Channel | undefined, value: number | string | undefined): string {
  if (value === undefined) return AWAITING_FIRST_READING;
  if (typeof value === "string" || !channel) return String(value);
  if (channel.kind === "duration") return pluralize(Math.floor(value / 86_400), "day");
  return `${value.toFixed(channel.precision)}${channel.unit ? ` ${channel.unit}` : ""}`;
}

export default async function DevicePage({ params }: { params: Promise<{ deviceId: string }> }) {
  const { deviceId } = await params;
  const dashboard = await orNotFound(apiGet(routes.devices.dashboard.path(deviceId), DeviceDashboard));
  const { device } = dashboard;
  const channels = new Map(dashboard.channels.map((c) => [c.key, c]));
  const pointsByChannel = new Map(dashboard.series.map((s) => [s.channel, s.points.length]));

  return (
    <PageContainer className="pt-11">
      <Link href="/live" className="text-[15px] text-muted hover:text-coral-deep">
        ← Live systems
      </Link>

      <div className="mt-[18px] flex flex-wrap items-end justify-between gap-6">
        <DeviceStatusHeader device={device} now={new Date()} />
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

      {/*
        Stub: the widgets are derived from the device's parts (CLOUD-PLATFORM.md §6.1).
        Each will render by `type`; for now they are listed so the data path is visible.
        A widget with no reading renders "Awaiting first reading", never a zero.
        Device chat (POST /v1/devices/:id/ask) lands with M6.5.
      */}
      <table className="mt-8 w-full max-w-[720px] border-collapse text-left text-[15px]">
        <thead className="font-mono text-[12px] uppercase tracking-[0.12em] text-muted">
          <tr>
            <th className="py-2 font-normal">Widget</th>
            <th className="py-2 font-normal">Channel</th>
            <th className="py-2 font-normal">Latest</th>
            <th className="py-2 font-normal">Note</th>
          </tr>
        </thead>
        <tbody>
          {dashboard.widgets.map((widget) => {
            const channel = channels.get(widget.channel);
            const note =
              widget.type === "line_chart"
                ? (pointsByChannel.get(widget.channel) ?? 0) === 0
                  ? `${widget.window} chart · ${AWAITING_FIRST_READING.toLowerCase()}`
                  : (widget.threshold?.label ?? "")
                : (widget.caption ?? "");
            return (
              <tr key={widget.id} className="border-t border-hairline">
                <td className="py-3 font-mono text-[13px]">{widget.type}</td>
                <td className="py-3">{channel?.label ?? widget.channel}</td>
                <td className="py-3 font-mono">{formatLatest(channel, dashboard.latest[widget.channel]?.v)}</td>
                <td className="py-3 text-muted">{note}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </PageContainer>
  );
}
