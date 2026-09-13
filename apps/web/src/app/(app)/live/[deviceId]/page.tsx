import type { Metadata } from "next";
import {
  TelemetryDeviceDetail,
  TelemetryDeviceParams,
  TelemetryHistory,
  TelemetryLatest,
  routes,
} from "@albusforge/schema";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DeviceChat } from "@/components/devices/DeviceChat";
import { HistoryPlot } from "@/components/telemetry/HistoryPlot";
import { PageContainer } from "@/components/ui";
import { apiGet, orNotFound } from "@/lib/api/server";
import { requireSession } from "@/lib/session";
import {
  historyFailure,
  selection,
  windows,
  type Search,
} from "@/lib/telemetry-monitor";

export const metadata: Metadata = { title: "Device telemetry" };

export default async function DevicePage({
  params,
  searchParams,
}: {
  params: Promise<{ deviceId: string }>;
  searchParams: Promise<Search>;
}) {
  const { deviceId } = await params;
  const me = await requireSession(`/live/${encodeURIComponent(deviceId)}`);
  if (!TelemetryDeviceParams.safeParse({ id: deviceId }).success) notFound();
  const detail = await orNotFound(
    apiGet(routes.telemetry.device.path(deviceId), TelemetryDeviceDetail),
  );
  const latest = await orNotFound(
    apiGet(routes.telemetry.latest.path(deviceId), TelemetryLatest),
  );
  const search = await searchParams,
    channels = Object.keys(detail.channels);
  const now = new Date();
  const selected = selection(search, channels, now.getTime());
  let history:
    | Awaited<ReturnType<typeof apiGet<typeof TelemetryHistory>>>
    | undefined;
  let error: string | undefined = selected.error;
  if (selected.query) {
    const query = new URLSearchParams(
      Object.entries(selected.query).map(([key, value]) => [
        key,
        String(value),
      ]),
    );
    try {
      history = await apiGet(
        `${routes.telemetry.series.path(deviceId)}?${query}`,
        TelemetryHistory,
      );
    } catch (failure) {
      const message = historyFailure(failure);
      if (!message) throw failure;
      error = message;
    }
  }
  const { device } = detail;
  const input = "min-w-0 w-full max-w-full border border-current/20 rounded-lg px-3 py-2 bg-transparent";
  return (
    <PageContainer>
      <Link href="/live" className="text-muted">
        ← Live systems
      </Link>
      <h1 className="text-3xl font-semibold mt-5 break-all">
        Device {device.id}
      </h1>
      <p className="mt-3">
        {device.revoked_at
          ? "Credential revoked"
          : device.status.replace("_", " ")}{" "}
        · Last packet: {device.last_seen_at ?? "never"}
      </p>
      <p className="text-muted mt-2">
        Snapshot on page load. Refresh to see new uploads; sample times below
        may differ from packet arrival.
      </p>
      {device.health && (
        <p className="mt-3">
          Health: {device.health.health.join(", ") || "No faults reported"}
          {device.health.batt_mv !== undefined &&
            ` · Battery ${device.health.batt_mv} mV`}
          {device.health.rssi !== undefined &&
            ` · Signal ${device.health.rssi} dBm`}
        </p>
      )}
      <h2 className="text-xl font-semibold mt-8">Latest readings</h2>
      <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
        {channels.map((channel) => {
          const sample = latest.readings.find((r) => r.channel === channel);
          return (
            <li
              key={channel}
              className="min-w-0 break-all rounded-2xl border border-current/10 p-5"
            >
              <h3>{channel}</h3>
              <p className="text-2xl mt-2">
                {sample
                  ? `${sample.v} ${detail.channels[channel]?.unit ?? ""}`
                  : "No reading yet"}
              </p>
              <p className="text-xs text-muted mt-2 break-all">
                {sample?.t ?? "Awaiting a sample"}
              </p>
            </li>
          );
        })}
      </ul>
      <section className="mt-10" aria-labelledby="history-title">
        <h2 id="history-title" className="text-xl font-semibold">
          Reading history
        </h2>
        <form className="flex flex-wrap items-end gap-4 mt-4">
          <label className="grid min-w-0 max-w-full gap-2">
            Channel
            <select
              name="channel"
              defaultValue={
                typeof search.channel === "string"
                  ? search.channel
                  : channels[0]
              }
              className={input}
            >
              {channels.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="grid min-w-0 max-w-full gap-2">
            Window
            <select
              name="window"
              defaultValue={selected.window ?? "hour"}
              className={input}
            >
              {Object.entries(windows).map(([key, value]) => (
                <option key={key} value={key}>
                  {value.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid min-w-0 max-w-full gap-2">
            Resolution
            <select
              name="resolution"
              defaultValue={
                typeof search.resolution === "string"
                  ? search.resolution
                  : "raw"
              }
              className={input}
            >
              <option value="raw">Raw samples (up to 24h)</option>
              <option value="1m">Minute averages (up to 7d)</option>
              <option value="1h">Hourly averages</option>
            </select>
          </label>
          <label className="grid min-w-0 max-w-full gap-2">
            End time (UTC, blank = now)
            <input
              type="datetime-local"
              max={now.toISOString().slice(0, 16)}
              name="end"
              defaultValue={typeof search.end === "string" ? search.end : ""}
              className={input}
            />
          </label>
          <button className="rounded-full bg-coral-deep text-white px-6 py-3">
            Apply / refresh
          </button>
        </form>
        <p className="text-sm text-muted mt-4">
          Averages cover completed UTC buckets. Dots mark actual times without
          filling gaps. Up to 2,000 points; excessive requests require a shorter
          window or coarser resolution.
        </p>
        {error && (
          <p role="alert" className="mt-5 border rounded-xl p-4">
            {error}
          </p>
        )}
        {history && (
          <>
            {history.pending_rollup && (
              <p role="status" className="mt-5">
                Rollups are pending. Averages may be stale or missing; refresh
                later or select raw samples.
              </p>
            )}
            <HistoryPlot
              history={history}
              unit={detail.channels[history.channel]?.unit ?? ""}
            />
          </>
        )}
      </section>
      <section className="mt-10 max-w-2xl" aria-label="Sensor questions">
        <DeviceChat
          key={`${me.tenant.id}:${deviceId}`}
          deviceId={deviceId}
          greeting="Choose a channel and time window, then ask about its stored readings."
          channels={channels.map((key) => ({ key, label: key, unit: detail.channels[key]!.unit }))}
        />
      </section>
    </PageContainer>
  );
}
