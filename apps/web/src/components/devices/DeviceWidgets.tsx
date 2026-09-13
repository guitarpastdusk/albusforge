import type { Channel, DeviceDashboard, Series, Widget } from "@albusforge/schema";
import { chartDomain, polylinePoints, valueToY } from "@/lib/chart";
import { cx } from "@/lib/cx";
import { AWAITING_FIRST_READING, formatChannelValue, joinReading } from "@/lib/format";

type LineChart = Extract<Widget, { type: "line_chart" }>;
type Stat = Extract<Widget, { type: "stat" }>;
type Latest = DeviceDashboard["latest"][string] | undefined;

/** The card-heading style shared by the dashboard's cards. */
export function CardLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[15px] font-semibold uppercase tracking-[0.1em] text-muted">{children}</h2>;
}

/**
 * The dashboard's widgets, rendered from config in order (CLOUD-PLATFORM.md
 * §6.1, PORTAL.md §6). Consecutive stat widgets share one tile grid.
 */
export function DeviceWidgets({ dashboard }: { dashboard: DeviceDashboard }) {
  const channels = new Map(dashboard.channels.map((channel) => [channel.key, channel]));
  const series = new Map(dashboard.series.map((s) => [s.channel, s]));

  const groups: Array<LineChart | Stat[]> = [];
  for (const widget of dashboard.widgets) {
    const previous = groups.at(-1);
    if (widget.type === "stat") {
      if (Array.isArray(previous)) previous.push(widget);
      else groups.push([widget]);
    } else {
      groups.push(widget);
    }
  }

  return groups.map((group) =>
    Array.isArray(group) ? (
      <div key={group[0]!.id} className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4">
        {group.map((widget) => (
          <StatTile
            key={widget.id}
            widget={widget}
            channel={channels.get(widget.channel)}
            latest={dashboard.latest[widget.channel]}
          />
        ))}
      </div>
    ) : (
      <LineChartCard
        key={group.id}
        widget={group}
        channel={channels.get(group.channel)}
        latest={dashboard.latest[group.channel]}
        series={series.get(group.channel)}
      />
    ),
  );
}

export function LineChartCard({
  widget,
  channel,
  latest,
  series,
}: {
  widget: LineChart;
  channel: Channel | undefined;
  latest: Latest;
  series: Series | undefined;
}) {
  const values = series?.points.map((point) => point.v) ?? [];
  const threshold = widget.threshold;
  const domain = chartDomain(values, threshold?.value ?? null) ?? (threshold ? chartDomain([threshold.value], threshold.value) : null);
  const reading = latest ? formatChannelValue(channel, latest.v) : null;
  const label = `${channel?.label ?? widget.channel} · last ${widget.window}`;

  return (
    <section className="rounded-[24px] border border-hairline bg-white px-8 py-7">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <CardLabel>{label}</CardLabel>
        {reading ? (
          <div className="font-mono text-[34px] text-ink">
            {reading.value}
            {reading.unit ? <span className="text-[18px] text-muted"> {reading.unit}</span> : null}
          </div>
        ) : (
          <div className="font-mono text-[15px] text-muted">{AWAITING_FIRST_READING}</div>
        )}
      </div>
      <svg viewBox="0 0 600 160" role="img" aria-label={`${label} chart`} className="mt-4 block h-auto w-full">
        {threshold && domain ? (
          <>
            <line
              x1="0"
              x2="600"
              y1={valueToY(threshold.value, domain)}
              y2={valueToY(threshold.value, domain)}
              strokeDasharray="4 6"
              className="stroke-hairline"
            />
            <text x="4" y={valueToY(threshold.value, domain) - 8} fontSize="12" className="fill-faint font-mono">
              {threshold.label}
            </text>
          </>
        ) : null}
        {domain && values.length > 0 ? (
          <polyline
            points={polylinePoints(values, domain)}
            fill="none"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="stroke-coral"
          />
        ) : null}
      </svg>
    </section>
  );
}

export function StatTile({ widget, channel, latest }: { widget: Stat; channel: Channel | undefined; latest: Latest }) {
  const reading = latest ? joinReading(formatChannelValue(channel, latest.v)) : null;

  return (
    <div className="rounded-[20px] border border-hairline bg-white px-6 py-[22px]">
      <div className="text-[13px] font-semibold uppercase tracking-[0.12em] text-muted">{channel?.label ?? widget.channel}</div>
      {reading ? (
        <div className={cx("mt-2 font-mono text-[28px]", widget.value_tone === "success" ? "text-success" : "text-ink")}>
          {reading}
        </div>
      ) : (
        <div className="mt-2 font-mono text-[28px] text-faint">—</div>
      )}
      {reading ? (
        widget.caption ? (
          <div className={cx("mt-1 text-[13px]", widget.caption_tone === "success" ? "text-success" : "text-muted")}>
            {widget.caption}
          </div>
        ) : null
      ) : (
        <div className="mt-1 text-[13px] text-muted">{AWAITING_FIRST_READING}</div>
      )}
    </div>
  );
}
