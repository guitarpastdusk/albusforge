import { TelemetryDeviceParams } from "@albusforge/schema";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { HistoryPlot } from "@/components/telemetry/HistoryPlot";
import { PublicNotice } from "@/components/showcase/PublicNotice";
import { PageContainer } from "@/components/ui";
import { publicLive } from "@/lib/api/public-live";
import { mapWithConcurrency } from "@/lib/concurrency";
import { orNotFound } from "@/lib/api/server";
import { seriesColor } from "@/lib/series-color";
import { historyFailure, selection, windows, type Search } from "@/lib/telemetry-monitor";

export const metadata: Metadata = { title: "Live demo · device" };

/** Kept under the gateway's pool budget, as on the authenticated device page. */
const SERIES_CONCURRENCY = 3;

export default async function ShowcaseDevicePage({
  params,
  searchParams,
}: {
  params: Promise<{ deviceId: string }>;
  searchParams: Promise<Search>;
}) {
  const { deviceId } = await params;
  if (!TelemetryDeviceParams.safeParse({ id: deviceId }).success) notFound();
  const detail = await orNotFound(publicLive.device(deviceId));
  const latest = await orNotFound(publicLive.latest(deviceId));
  const search = await searchParams;
  const channels = Object.keys(detail.channels);
  const now = new Date();
  // The channel parameter is retired here as it is on the authenticated page:
  // every channel is plotted.
  const sharedSearch: Search = Object.fromEntries(Object.entries(search).filter(([key]) => key !== "channel"));
  const selected = selection(sharedSearch, channels, now.getTime());

  const plots = await mapWithConcurrency(channels, SERIES_CONCURRENCY, async (channel) => {
    const forChannel = selection(sharedSearch, channels, now.getTime(), channel);
    if (!forChannel.query) return { channel, error: forChannel.error };
    const query = new URLSearchParams(Object.entries(forChannel.query).map(([key, value]) => [key, String(value)]));
    try {
      return { channel, history: await publicLive.series(deviceId, query) };
    } catch (failure) {
      const message = historyFailure(failure);
      if (!message) throw failure;
      return { channel, error: message };
    }
  });

  const { device } = detail;
  return (
    <PageContainer>
      <Link href="/showcase" className="text-muted">← Live demo</Link>
      <h1 className="mt-5 break-all font-display text-[clamp(26px,2.6vw,34px)] font-medium">
        {device.display_name ?? `Device ${device.id}`}
      </h1>
      <PublicNotice />

      <p className="mt-5 text-[15px]">
        {device.revoked_at
          ? "Credential revoked"
          : device.status === "never_seen"
            ? "Awaiting first upload"
            : device.status === "online"
              ? "Online"
              : "Offline"}{" "}
        · Last upload: {device.last_seen_at ?? "never"}
      </p>
      <p className="mt-2 text-[14px] text-muted">
        Snapshot on page load. Refresh to see new uploads; sample times may differ from packet arrival.
      </p>
      <Link href={`/showcase/${device.id}/setup`} className="mt-3 inline-block text-coral-deep underline">
        See how this device is put together →
      </Link>

      {channels.length === 0 ? (
        <p className="mt-10 text-muted">This device has not stored any readings yet.</p>
      ) : (
        <>
          <h2 className="mt-10 font-display text-[24px]">Latest readings</h2>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2">
            {channels.map((channel) => {
              const sample = latest.readings.find((r) => r.channel === channel);
              return (
                <li key={channel} className="min-w-0 break-all rounded-2xl border border-hairline bg-white p-5">
                  <h3 className="text-[15px] text-ink">{channel}</h3>
                  <p className="mt-2 text-[24px]">{sample ? `${sample.v} ${detail.channels[channel]?.unit ?? ""}` : "No reading yet"}</p>
                  <p className="mt-2 break-all text-[12px] text-faint">{sample?.t ?? "Awaiting a sample"}</p>
                </li>
              );
            })}
          </ul>

          <section className="mt-10" aria-labelledby="history-title">
            <h2 id="history-title" className="font-display text-[24px]">Reading history</h2>
            <form className="mt-4 flex flex-wrap items-end gap-4">
              <label className="grid gap-2 text-[14px] text-muted">
                Window
                <select name="window" defaultValue={selected.window ?? "hour"} className="rounded-xl border border-hairline bg-white px-4 py-3 text-[16px] text-ink">
                  {Object.entries(windows).map(([key, value]) => (
                    <option key={key} value={key}>{value.label}</option>
                  ))}
                </select>
              </label>
              <button className="rounded-xl bg-coral-deep px-5 py-3 text-[16px] text-white">Apply</button>
            </form>
            {selected.error && <p role="alert" className="mt-5 text-coral-deep">{selected.error}</p>}
            <div className="mt-6 grid gap-5 xl:grid-cols-2">
              {plots.map((plot, index) => (
                <section key={plot.channel} aria-label={`${plot.channel} history`} className="min-w-0 rounded-[20px] border border-hairline bg-white px-5 py-4">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: seriesColor(index) }} />
                    <h3 className="min-w-0 break-all text-[16px] font-semibold text-ink">{plot.channel}</h3>
                    <span className="font-mono text-[13px] text-muted">{detail.channels[plot.channel]?.unit ?? ""}</span>
                  </div>
                  {plot.error ? (
                    <p role="alert" className="mt-4 text-[15px] text-coral-deep">{plot.error}</p>
                  ) : plot.history ? (
                    <HistoryPlot history={plot.history} unit={detail.channels[plot.channel]?.unit ?? ""} color={seriesColor(index)} />
                  ) : null}
                </section>
              ))}
            </div>
          </section>
        </>
      )}
    </PageContainer>
  );
}
