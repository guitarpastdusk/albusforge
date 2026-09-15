import { TelemetryDeviceParams } from "@albusforge/schema";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BenchLayout } from "@/components/setup/BenchLayout";
import { PublicNotice } from "@/components/showcase/PublicNotice";
import { PageContainer } from "@/components/ui";
import { orNotFound } from "@/lib/api/server";
import { publicLive } from "@/lib/api/public-live";

export const metadata: Metadata = { title: "Live demo · setup" };

/**
 * The public setup view: what the device reports about its own reception, and
 * how it is put together.
 *
 * Deliberately not DeviceSetupView. That component carries the claim, credential
 * and configuration controls a workspace operator needs, and none of those
 * belong on a page anyone can open — a disabled control is still a control that
 * a later edit can enable. This renders the reported state only.
 */
export default async function ShowcaseSetupPage({ params }: { params: Promise<{ deviceId: string }> }) {
  const { deviceId } = await params;
  if (!TelemetryDeviceParams.safeParse({ id: deviceId }).success) notFound();
  const setup = await orNotFound(publicLive.setup(deviceId));

  const receipts = [setup.last_packet_at, ...(setup.capabilities ?? []).map((cap) => cap.last_received_at)]
    .filter((time): time is string => time !== null)
    .map((time) => Date.parse(time))
    .filter(Number.isFinite);
  const lastAccepted = receipts.length ? new Date(Math.max(...receipts)).toISOString() : "None recorded";

  return (
    <PageContainer>
      <Link href={`/showcase/${deviceId}`} className="text-muted">← Back to the device</Link>
      <h1 className="mt-5 font-display text-[clamp(26px,2.6vw,34px)] font-medium">Device setup</h1>
      <PublicNotice deviceHref={`/showcase/${deviceId}`} />

      <div className="mt-8 rounded-[24px] border border-hairline bg-white p-6">
        <h2 className="font-display text-[26px]">Cloud reception</h2>
        <dl className="mt-5 grid gap-4 text-[15px] sm:grid-cols-2">
          <div><dt className="text-muted">State</dt><dd>{setup.state.replaceAll("_", " ")}</dd></div>
          <div><dt className="text-muted">Last accepted upload</dt><dd className="break-words">{lastAccepted}</dd></div>
          <div>
            <dt className="text-muted">Upload interval{setup.capabilities?.length ? "s" : ""}</dt>
            <dd>{setup.capabilities?.length ? setup.capabilities.map((cap) => `${cap.id}: ${cap.interval_s}s`).join("; ") : `${setup.upload_interval_s} seconds`}</dd>
          </div>
          <div><dt className="text-muted">Checked at (UTC)</dt><dd className="break-words">{setup.checked_at}</dd></div>
        </dl>
      </div>

      {!!setup.capabilities?.length && (
        <div className="mt-6 rounded-[24px] border border-hairline bg-white p-6">
          <h2 className="font-display text-[26px]">Sensors and cameras</h2>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2">
            {setup.capabilities.map((cap) => (
              <li key={cap.id} className="rounded-2xl border border-hairline p-4">
                <h3 className="text-[15px] text-ink">{cap.id}</h3>
                <p className="text-[15px]">{cap.status.replaceAll("_", " ")} · every {cap.interval_s} seconds</p>
                <p className="mt-2 text-[14px] text-muted">Last capture: {cap.last_capture_at ?? "Waiting"}</p>
                <p className="text-[14px] text-muted">Last received: {cap.last_received_at ?? "Waiting"}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {setup.channels.length > 0 && (
        <div className="mt-6 rounded-[24px] border border-hairline bg-white p-6">
          <h2 className="font-display text-[26px]">Registered channels</h2>
          <ul className="mt-5 grid gap-4 sm:grid-cols-2">
            {setup.channels.map((channel) => (
              <li key={channel.key} className="min-w-0 rounded-2xl border border-hairline p-4">
                <h3 className="break-all text-[15px] font-medium text-ink">{channel.key}</h3>
                {channel.latest ? (
                  <>
                    <p className="mt-2 text-[20px]">{channel.latest.value} {channel.unit}</p>
                    <p className="mt-2 break-words text-[13px] text-muted">Sample recorded at {channel.latest.at}</p>
                  </>
                ) : (
                  <p className="mt-2 text-muted">Waiting for a reading · {channel.unit}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6">
        <BenchLayout />
      </div>
    </PageContainer>
  );
}
