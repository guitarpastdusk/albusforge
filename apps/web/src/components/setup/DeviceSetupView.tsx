import type { DeviceSetupStatus } from "@albusforge/schema";
import Link from "next/link";
import { RefreshSetup } from "./RefreshSetup";

const COPY: Record<DeviceSetupStatus["state"], { title: string; description: string }> = {
  waiting_for_upload: { title: "Waiting for an authenticated upload", description: "The device is registered in this workspace. No accepted upload receipt is recorded yet. Use the firmware and connection instructions supplied by your device provisioner, then power on the device." },
  waiting_for_channels: { title: "Upload received · some channels are waiting", description: "Cloud ingestion accepted an authenticated packet. The channel list below shows which readings have arrived and which still need a sample." },
  waiting_for_capabilities: { title: "Some sensors are still waiting", description: "An upload arrived. Each required sensor or camera must send its own observation to complete setup." },
  degraded: { title: "Reception needs attention", description: "At least one required sensor is disabled or has stopped sending fresh observations. Check its status below." },
  confirmed: { title: "Cloud reception confirmed", description: "An authenticated upload has been accepted, and every required sensor has sent an observation. This confirms cloud reception; it does not verify physical assembly, calibration or firmware safety." },
  credential_revoked: { title: "Device credential revoked", description: "This device can no longer upload with its revoked credential. Contact the person who provisioned it to arrange a supported recovery. Existing readings and pictures remain available." },
};

export function DeviceSetupView({ setup }: { setup: DeviceSetupStatus }) {
  const copy = COPY[setup.state];
  const receiptTimes = [setup.last_packet_at, ...(setup.capabilities ?? []).map(cap => cap.last_received_at)]
    .filter((time): time is string => time !== null).map(time => Date.parse(time)).filter(Number.isFinite);
  const lastAccepted = receiptTimes.length ? new Date(Math.max(...receiptTimes)).toISOString() : "None recorded";
  const waiting = setup.state === "waiting_for_upload" || setup.state === "waiting_for_channels" || setup.state === "waiting_for_capabilities";
  return (
    <section className="mt-8 space-y-6" aria-labelledby="setup-status">
      <div className="rounded-[24px] border border-hairline bg-white p-6">
        <h2 id="setup-status" className="font-display text-[28px]">{copy.title}</h2>
        <p className="mt-3 max-w-[760px] text-muted">{copy.description}</p>
        <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
          <div><dt className="text-muted">Registered device</dt><dd className="break-all font-mono">{setup.device_id}</dd></div>
          <div><dt className="text-muted">Last accepted upload</dt><dd className="break-words">{lastAccepted}</dd></div>
          <div><dt className="text-muted">Configured upload interval{setup.capabilities?.length ? "s" : ""}</dt><dd>{setup.capabilities?.length ? setup.capabilities.map(cap => `${cap.id}: ${cap.interval_s} seconds`).join("; ") : `${setup.upload_interval_s} seconds`}</dd></div>
          <div><dt className="text-muted">Checked at (UTC)</dt><dd className="break-words">{setup.checked_at}</dd></div>
        </dl>
        <RefreshSetup key={setup.device_id} waiting={waiting} />
      </div>
      {!!setup.capabilities?.length && <div className="rounded-[24px] border border-hairline bg-white p-6">
        <h2 className="font-display text-[26px]">Sensors and cameras</h2>
        <ul className="mt-4 grid gap-4 sm:grid-cols-2">{setup.capabilities.map(cap => <li key={cap.id} className="rounded-2xl border border-hairline p-4">
          <h3>{cap.id}</h3><p>{cap.status.replaceAll("_", " ")} · every {cap.interval_s} seconds</p>
          <p className="mt-2 text-sm text-muted">Last capture: {cap.last_capture_at ?? "Waiting"}</p>
          <p className="text-sm text-muted">Last received: {cap.last_received_at ?? "Waiting"}</p>
        </li>)}</ul>
      </div>}
      {setup.channels.length > 0 && <div className="rounded-[24px] border border-hairline bg-white p-6">
        <h2 className="font-display text-[26px]">Registered channels</h2>
        <p className="mt-2 text-sm text-muted">Sample time can precede packet arrival. These stored readings can include backfilled samples.</p>
        <ul className="mt-5 grid gap-4 sm:grid-cols-2">
          {setup.channels.map(channel => <li key={channel.key} className="min-w-0 rounded-2xl border border-hairline p-4">
            <h3 className="break-all font-medium">{channel.key}</h3>
            {channel.latest ? <><p className="mt-2 text-xl">{channel.latest.value} {channel.unit}</p><p className="mt-2 break-words text-sm text-muted">Sample recorded at {channel.latest.at}</p></> : <p className="mt-2 text-muted">Waiting for a reading · {channel.unit}</p>}
          </li>)}
        </ul>
      </div>}
      <div className="flex flex-wrap gap-5"><Link href={`/live/${setup.device_id}`} className="font-medium text-coral-deep">Open readings, pictures and history →</Link><Link href="/live" className="text-muted">Return to live systems</Link></div>
      <section className="max-w-[760px] rounded-2xl bg-porcelain p-6" aria-labelledby="setup-help">
        <h2 id="setup-help" className="font-display text-[24px]">If uploads do not arrive</h2>
        <p className="mt-3 text-muted">Check power and network access using your provisioner’s instructions. Ask them to verify that the firmware contains this device’s existing identity and the correct ingestion endpoint. Never paste a device token into this page or a support message.</p>
        <p className="mt-3 text-muted">Check each sensor’s last received time against its own configured interval. A working sensor does not confirm that another sensor or camera is working. Missing readings or pictures may need a sensor, camera or firmware check by the provisioner.</p>
      </section>
    </section>
  );
}
