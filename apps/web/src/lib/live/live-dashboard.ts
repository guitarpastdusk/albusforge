import type { DeviceDashboard, DeviceStatusEvent, ReadingEvent, Series } from "@albusforge/schema";

import { acceptsValue, laterTime } from "./live-fleet";

// Stream samples update latest values and raw series only. Server rollups remain
// authoritative: one raw sample cannot replace an aggregate. An explicit refresh or reconnect
// supplies fresh rollups without discarding newer latest values.
/** Raw series are bounded by their widget window and a hard point cap. */
const WINDOW_SECONDS = { "1h": 3600, "24h": 86_400, "7d": 7 * 86_400, "30d": 30 * 86_400 } as const;
const RAW_CAP = 600;

export function applyReadingToDashboard(dashboard: DeviceDashboard, event: ReadingEvent): DeviceDashboard {
  if (event.device_id !== dashboard.device.id) return dashboard;
  const channel = dashboard.channels.find((c) => c.key === event.channel);
  if (!channel || !acceptsValue(channel, event.v)) return dashboard;
  const current = dashboard.latest[event.channel];
  const advancesLatest = !current || Date.parse(event.t) > Date.parse(current.t);
  const v = event.v;
  const series =
    typeof v === "number"
      ? dashboard.series.map((s) => (s.channel === event.channel && s.bucket === "raw" ? appendPoint(s, event.t, v, windowFor(dashboard, event.channel)) : s))
      : dashboard.series;
  if (!advancesLatest) {
    return series.some((entry, index) => entry !== dashboard.series[index]) ? { ...dashboard, series } : dashboard;
  }
  const latest = { ...dashboard.latest, [event.channel]: { v: event.v, t: event.t } };
  const lastAt = dashboard.device.last_reading_at;
  const observed = dashboard.device.status_at ?? lastAt;
  const advancesPresence = !observed || Date.parse(event.t) > Date.parse(observed);
  const device = {
    ...dashboard.device,
    status: advancesPresence ? "online" as const : dashboard.device.status,
    status_at: advancesPresence ? event.t : dashboard.device.status_at,
    last_reading_at: lastAt && Date.parse(lastAt) > Date.parse(event.t) ? lastAt : event.t,
  };
  return { ...dashboard, device, latest, series };
}

export function applyStatusToDashboard(dashboard: DeviceDashboard, event: DeviceStatusEvent): DeviceDashboard {
  if (event.device_id !== dashboard.device.id) return dashboard;
  const observed = dashboard.device.status_at ?? dashboard.device.last_reading_at;
  if (observed && Date.parse(event.at) <= Date.parse(observed)) return dashboard;
  return {
    ...dashboard,
    device: { ...dashboard.device, status: event.status, status_at: event.at, last_reading_at: laterTime(dashboard.device.last_reading_at, event.last_reading_at) },
  };
}

function windowFor(dashboard: DeviceDashboard, channel: string): number {
  const widget = dashboard.widgets.find((w) => w.type === "line_chart" && w.channel === channel);
  return widget && widget.type === "line_chart" ? WINDOW_SECONDS[widget.window] : WINDOW_SECONDS["24h"];
}

function appendPoint(series: Series, t: string, v: number, windowSeconds: number): Series {
  const at = Date.parse(t);
  if (series.points.some((point) => Date.parse(point.t) === at)) return series;
  let points = [...series.points, { t, v }]
    .sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  // Drop what fell out of the window; cap raw series so a long-lived tab stays bounded.
  const from = Date.parse(points.at(-1)!.t) - windowSeconds * 1000;
  points = points.filter((p) => Date.parse(p.t) >= from);
  if (points.length > RAW_CAP) points = points.slice(points.length - RAW_CAP);
  if (points.length === series.points.length && points.every((point, index) => point === series.points[index])) return series;
  return { ...series, points };
}

export function mergeDashboardSnapshot(snapshot: DeviceDashboard, current: DeviceDashboard): DeviceDashboard {
  if (snapshot.device.id !== current.device.id) return snapshot;
  let result = snapshot;
  for (const [channel, reading] of Object.entries(current.latest)) {
    const incoming = snapshot.latest[channel];
    if (!incoming || Date.parse(reading.t) > Date.parse(incoming.t)) {
      result = applyReadingToDashboard(result, { device_id: snapshot.device.id, channel, ...reading });
    }
  }
  result = { ...result, series: result.series.map((series) => {
    if (series.bucket !== "raw" || !result.channels.some((channel) => channel.key === series.channel)) return series;
    const old = current.series.find((candidate) => candidate.channel === series.channel && candidate.bucket === "raw");
    let merged = series;
    for (const point of old?.points ?? []) {
      // Union historical samples too; snapshot values win timestamp collisions.
      merged = appendPoint(merged, point.t, point.v, windowFor(result, series.channel));
    }
    return merged;
  }) };
  const oldAt = current.device.status_at ?? current.device.last_reading_at;
  const newAt = result.device.status_at ?? result.device.last_reading_at;
  if (oldAt && (!newAt || Date.parse(oldAt) > Date.parse(newAt))) {
    result = { ...result, device: { ...result.device, status: current.device.status, status_at: oldAt } };
  }
  return { ...result, device: { ...result.device, last_reading_at: laterTime(result.device.last_reading_at, current.device.last_reading_at) } };
}
