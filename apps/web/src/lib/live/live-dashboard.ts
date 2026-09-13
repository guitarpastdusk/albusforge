import type { DeviceDashboard, DeviceStatusEvent, ReadingEvent, Series } from "@albusforge/schema";

/*
 * Applying stream events to one device's dashboard (CLOUD-PLATFORM.md §6.2).
 * Pure. A reading updates `latest` for its channel and the chart's series:
 * the series is bucketed (1m/1h rollups), so a reading inside the last
 * bucket replaces that point and a later one appends, keeping the window's
 * point count bounded. Events for other devices are ignored.
 */

const BUCKET_SECONDS: Record<Series["bucket"], number> = { raw: 0, "1m": 60, "1h": 3600 };

/** Points a window holds at the series' bucket; raw series keep what they had plus new points, capped. */
const WINDOW_SECONDS = { "1h": 3600, "24h": 86_400, "7d": 7 * 86_400, "30d": 30 * 86_400 } as const;
const RAW_CAP = 600;

export function applyReadingToDashboard(dashboard: DeviceDashboard, event: ReadingEvent): DeviceDashboard {
  if (event.device_id !== dashboard.device.id) return dashboard;
  const current = dashboard.latest[event.channel];
  if (current && Date.parse(event.t) < Date.parse(current.t)) return dashboard;

  const latest = { ...dashboard.latest, [event.channel]: { v: event.v, t: event.t } };
  const v = event.v;
  const series =
    typeof v === "number"
      ? dashboard.series.map((s) => (s.channel === event.channel ? appendPoint(s, event.t, v, windowFor(dashboard, event.channel)) : s))
      : dashboard.series;
  const lastAt = dashboard.device.last_reading_at;
  const device = {
    ...dashboard.device,
    status: "online" as const,
    last_reading_at: lastAt && Date.parse(lastAt) > Date.parse(event.t) ? lastAt : event.t,
  };
  return { ...dashboard, device, latest, series };
}

export function applyStatusToDashboard(dashboard: DeviceDashboard, event: DeviceStatusEvent): DeviceDashboard {
  if (event.device_id !== dashboard.device.id) return dashboard;
  return {
    ...dashboard,
    device: { ...dashboard.device, status: event.status, last_reading_at: event.last_reading_at ?? dashboard.device.last_reading_at },
  };
}

function windowFor(dashboard: DeviceDashboard, channel: string): number {
  const widget = dashboard.widgets.find((w) => w.type === "line_chart" && w.channel === channel);
  return widget && widget.type === "line_chart" ? WINDOW_SECONDS[widget.window] : WINDOW_SECONDS["24h"];
}

function appendPoint(series: Series, t: string, v: number, windowSeconds: number): Series {
  const at = Date.parse(t);
  const bucket = BUCKET_SECONDS[series.bucket];
  const last = series.points.at(-1);
  let points: Series["points"];
  if (last && bucket > 0 && Math.floor(at / 1000 / bucket) === Math.floor(Date.parse(last.t) / 1000 / bucket)) {
    points = [...series.points.slice(0, -1), { t, v }];
  } else {
    points = [...series.points, { t, v }];
  }
  // Drop what fell out of the window; cap raw series so a long-lived tab stays bounded.
  const from = at - windowSeconds * 1000;
  points = points.filter((p) => Date.parse(p.t) >= from);
  if (bucket === 0 && points.length > RAW_CAP) points = points.slice(points.length - RAW_CAP);
  return { ...series, points };
}
