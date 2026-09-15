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
import { ObservationGallery } from "@/components/telemetry/ObservationGallery";
import { AwaitingReadings } from "@/components/telemetry/AwaitingReadings";
import { DeviceConsole } from "@/components/devices/DeviceConsole";
import { DeviceNameEditor } from "@/components/telemetry/DeviceNameEditor";
import { HistoryPlot } from "@/components/telemetry/HistoryPlot";
import { PageContainer } from "@/components/ui";
import { mapWithConcurrency } from "@/lib/concurrency";
import { seriesColor } from "@/lib/series-color";
import { apiGet, orNotFound } from "@/lib/api/server";
import { requireSession } from "@/lib/session";
import {
  historyFailure,
  selection,
  windows,
  type Search,
} from "@/lib/telemetry-monitor";

export const metadata: Metadata = { title: "Device telemetry" };

/**
 * Series requests in flight at once. Kept under the gateway's five-client pool,
 * so plotting a device with many channels never starves its own page — or the
 * unrelated traffic sharing that pool.
 */
const SERIES_CONCURRENCY = 3;

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
    apiGet(
      `${routes.telemetry.device.path(deviceId)}?presentation=1`,
      TelemetryDeviceDetail,
    ),
  );
  const latest = await orNotFound(
    apiGet(routes.telemetry.latest.path(deviceId), TelemetryLatest),
  );
  const search = await searchParams,
    channels = Object.keys(detail.channels);
  const now = new Date();
  // The channel parameter is retired: every channel is plotted. Dropping it from
  // the shared state stops a bookmarked ?channel=removed_channel reporting
  // "choose a provisioned channel" over a page of working plots.
  const sharedSearch: Search = Object.fromEntries(Object.entries(search).filter(([key]) => key !== "channel"));
  const selected = selection(sharedSearch, channels, now.getTime());
  // One plot per channel, over the one window chosen above: a person watching a
  // device wants to see moisture against temperature, not pick them one at a
  // time. Fetched together so a slow channel doesn't serialise the rest.
  const plots = await mapWithConcurrency(channels, SERIES_CONCURRENCY, async (channel) => {
      const forChannel = selection(sharedSearch, channels, now.getTime(), channel);
      if (!forChannel.query) return { channel, error: forChannel.error };
      const query = new URLSearchParams(
        Object.entries(forChannel.query).map(([key, value]) => [key, String(value)]),
      );
      try {
        return {
          channel,
          history: await apiGet(
            `${routes.telemetry.series.path(deviceId)}?${query}`,
            TelemetryHistory,
          ),
        };
      } catch (failure) {
        const message = historyFailure(failure);
        if (!message) throw failure;
        // One channel failing is its own plot's problem, not the page's.
        return { channel, error: message };
      }
  });
  const error: string | undefined = selected.error;
  const pendingRollup = plots.some((plot) => plot.history?.pending_rollup);
  const { device } = detail;
  const input =
    "min-w-0 w-full max-w-full border border-current/20 rounded-lg px-3 py-2 bg-transparent";
  return (
    <PageContainer>
      <Link href="/live" className="text-muted">
        ← Live systems
      </Link>
      <h1 className="text-3xl font-semibold mt-5 break-all">
        {device.display_name ?? `Device ${device.id}`}
      </h1>
      {device.display_name && (
        <p className="mt-2 text-sm text-muted break-all">
          Device ID: {device.id}
        </p>
      )}
      <Link
        href={`/setup?device=${device.id}`}
        className="inline-block mt-3 text-coral-deep underline"
      >
        Check device setup
      </Link>
      {detail.permissions?.edit_metadata ? (
        <DeviceNameEditor
          key={`${device.id}:${device.metadata_version}`}
          id={device.id}
          name={device.display_name ?? null}
          version={device.metadata_version ?? 0}
        />
      ) : (
        <p className="mt-3 text-sm text-muted">
          Device labels can be edited by workspace operators and admins.
        </p>
      )}
      <p className="mt-3">
        {device.revoked_at
          ? "Credential revoked"
          : device.status === "never_seen"
            ? "Awaiting first upload"
            : device.status === "online"
              ? "Online"
              : "Offline"}{" "}
        · Last upload: {device.last_seen_at ?? "never"}
      </p>
      <p className="text-muted mt-2">
        Snapshot on page load. Refresh to see new uploads; sample times below
        may differ from packet arrival.
      </p>
      <p className="mt-2 text-sm text-muted">
        {detail.capabilities?.length ? <>
          Each sensor uses its configured interval: {detail.capabilities.map(cap => `${cap.id} every ${cap.interval_s} seconds`).join("; ")}.{" "}
          Overall status summarizes required sources; check each sensor or camera for its reception status.{" "}
        </> : <>Expected upload interval: {device.next_s} seconds. Offline means no
          recent packet within {Math.max(60, device.next_s * 3)} seconds.{" "}</>}
        {device.revoked_at
          ? "The credential is revoked; new uploads are blocked, but stored readings remain available."
          : "Status is a current connectivity estimate, not a historical alert."}
      </p>
      {!device.health && channels.length > 0 && (
        <p className="mt-2 text-sm text-muted">
          No device health packet has been recorded.
        </p>
      )}
      {device.health && (
        <p className="mt-3">
          Health: {device.health.health.join(", ") || "No faults reported"}
          {device.health.batt_mv !== undefined &&
            ` · Battery ${device.health.batt_mv} mV`}
          {device.health.rssi !== undefined &&
            ` · Signal ${device.health.rssi} dBm`}
        </p>
      )}
      {/* Data on the left, the conversation beside it: the person can read a
          plot and ask about what they are looking at without losing either. */}
      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(360px,420px)] lg:items-start">
        <div className="min-w-0">
      {detail.capabilities && <ObservationGallery deviceId={deviceId} capabilities={detail.capabilities} search={search} />}
      {channels.length === 0 && <AwaitingReadings deviceId={device.id} revoked={Boolean(device.revoked_at)} />}
      {channels.length > 0 && <>
      <h2 className="text-xl font-semibold mt-8">Latest readings</h2>
      <ul className="grid sm:grid-cols-2 gap-4 mt-4">
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
        {pendingRollup && (
          <p role="status" className="mt-5">
            Rollups are pending. Averages may be stale or missing; refresh later
            or select raw samples.
          </p>
        )}
        <div className="mt-6 grid gap-5 xl:grid-cols-2">
          {plots.map((plot, index) => (
            <section
              key={plot.channel}
              aria-label={`${plot.channel} history`}
              className="min-w-0 rounded-[20px] border border-hairline bg-white px-5 py-4"
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                {/* The dot repeats the mark's colour beside a heading that names
                    the channel, so identity never rests on the colour alone. */}
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ background: seriesColor(index) }}
                />
                <h3 className="min-w-0 break-all text-[16px] font-semibold text-ink">
                  {plot.channel}
                </h3>
                <span className="font-mono text-[13px] text-muted">
                  {detail.channels[plot.channel]?.unit ?? ""}
                </span>
              </div>
              {plot.error ? (
                <p role="alert" className="mt-4 text-[15px] text-coral-deep">
                  {plot.error}
                </p>
              ) : plot.history ? (
                <HistoryPlot
                  history={plot.history}
                  unit={detail.channels[plot.channel]?.unit ?? ""}
                  color={seriesColor(index)}
                />
              ) : null}
            </section>
          ))}
        </div>
      </section>
      </>}
        </div>
        <DeviceConsole
          key={`${me.tenant.id}:${deviceId}`}
          deviceId={deviceId}
          deviceName={device.display_name ?? "this device"}
          channelCount={channels.length}
        />
      </div>
    </PageContainer>
  );
}
