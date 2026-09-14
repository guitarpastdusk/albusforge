import type { DeviceSetupStatus } from "@albusforge/schema";
import Link from "next/link";
import { RefreshSetup } from "./RefreshSetup";

const COPY: Record<DeviceSetupStatus["state"], { title: string; description: string }> = {
  waiting_for_upload: { title: "Waiting for an authenticated upload", description: "The device is registered in this workspace. No accepted upload receipt is recorded yet. Use the firmware and connection instructions supplied by your device provisioner, then power on the device." },
  waiting_for_channels: { title: "Upload received · some channels are waiting", description: "Cloud ingestion accepted an authenticated packet. The channel list below shows which readings have arrived and which still need a sample." },
  confirmed: { title: "Cloud reception confirmed", description: "An authenticated upload has been accepted, and every registered channel has a stored reading. This confirms cloud reception; it does not verify physical assembly, calibration or firmware safety." },
  credential_revoked: { title: "Device credential revoked", description: "This device can no longer upload with its revoked credential. Contact the person who provisioned it to arrange a supported recovery. Existing readings remain available." },
};

export function DeviceSetupView({ setup }: { setup: DeviceSetupStatus }) {
  const copy = COPY[setup.state];
  const waiting = setup.state === "waiting_for_upload" || setup.state === "waiting_for_channels";
  return (
    <section className="mt-8 space-y-6" aria-labelledby="setup-status">
      <div className="rounded-[24px] border border-hairline bg-white p-6">
        <h2 id="setup-status" className="font-display text-[28px]">{copy.title}</h2>
        <p className="mt-3 max-w-[760px] text-muted">{copy.description}</p>
        <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
          <div><dt className="text-muted">Registered device</dt><dd className="break-all font-mono">{setup.device_id}</dd></div>
          <div><dt className="text-muted">Last accepted packet</dt><dd className="break-words">{setup.last_packet_at ?? "None recorded"}</dd></div>
          <div><dt className="text-muted">Configured upload interval</dt><dd>{setup.upload_interval_s} seconds</dd></div>
          <div><dt className="text-muted">Checked at (UTC)</dt><dd className="break-words">{setup.checked_at}</dd></div>
        </dl>
        <RefreshSetup key={setup.device_id} waiting={waiting} />
      </div>
      <div className="rounded-[24px] border border-hairline bg-white p-6">
        <h2 className="font-display text-[26px]">Registered channels</h2>
        <p className="mt-2 text-sm text-muted">Sample time can precede packet arrival. These stored readings can include backfilled samples.</p>
        <ul className="mt-5 grid gap-4 sm:grid-cols-2">
          {setup.channels.map(channel => <li key={channel.key} className="min-w-0 rounded-2xl border border-hairline p-4">
            <h3 className="break-all font-medium">{channel.key}</h3>
            {channel.latest ? <><p className="mt-2 text-xl">{channel.latest.value} {channel.unit}</p><p className="mt-2 break-words text-sm text-muted">Sample recorded at {channel.latest.at}</p></> : <p className="mt-2 text-muted">Waiting for a reading · {channel.unit}</p>}
          </li>)}
        </ul>
      </div>
      <div className="flex flex-wrap gap-5"><Link href={`/live/${setup.device_id}`} className="font-medium text-coral-deep">Open readings and history →</Link><Link href="/live" className="text-muted">Return to live systems</Link></div>
      <section className="max-w-[760px] rounded-2xl bg-porcelain p-6" aria-labelledby="setup-help">
        <h2 id="setup-help" className="font-display text-[24px]">If readings do not arrive</h2>
        <p className="mt-3 text-muted">Check power and network access using your provisioner’s instructions. Ask them to verify that the firmware contains this device’s existing identity and the correct ingestion endpoint. Never paste a device token into this page or a support message.</p>
        <p className="mt-3 text-muted">If the last packet is older than several configured upload intervals, check connectivity before expecting new readings. Missing channels may need a sensor or firmware check by the provisioner.</p>
      </section>
    </section>
  );
}
