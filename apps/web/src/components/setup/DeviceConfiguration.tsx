"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { DeviceProvisioning } from "@albusforge/schema";
import { replaceDeviceConfiguration, revokeDeviceCredential } from "@/actions/device-provisioning";

export function DeviceConfiguration({ provisioning, tenantId, mayWrite }: { provisioning: DeviceProvisioning; tenantId: string; mayWrite: boolean }) {
  const router = useRouter(), requestId = useRef<string | null>(null);
  const [pending, startTransition] = useTransition(), [message, setMessage] = useState("");
  const [replaceConfirmed, setReplaceConfirmed] = useState(false), [revokeConfirmed, setRevokeConfirmed] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const request = { expected_tenant_id: tenantId, expected_version: provisioning.credential_version };
  const revoked = provisioning.state === "credential_revoked";
  return <section className="mt-8 space-y-5 rounded-[24px] border border-hairline bg-white p-6" aria-labelledby="device-configuration">
    <h2 id="device-configuration" className="font-display text-[28px]">Install your device configuration</h2>
    <p className="text-muted">Plan {provisioning.plan_version} · firmware version {provisioning.code_version} · configuration {provisioning.credential_version}.</p>
    <p className="text-muted">Keep the downloaded file private. It contains this device’s upload credential. The installer checks it against your firmware manifest and asks for Wi-Fi details locally.</p>
    <Link href={`/projects/${provisioning.build_id}`} className="inline-block text-coral-deep">Open firmware and installation instructions →</Link>
    {revoked ? <p className="text-muted">This identity is revoked. It cannot upload or issue another configuration.</p> : !mayWrite ? <p className="text-muted">An operator or admin must download or replace configuration.</p> : <>
      {provisioning.handoff_available && !downloaded ? <div>
        <p className="mb-3 text-sm text-muted">One download, available until {provisioning.handoff_expires_at}.</p>
        <button disabled={pending} className="rounded-xl bg-coral-deep px-5 py-3 text-white disabled:opacity-60" onClick={() => startTransition(async () => {
          try {
            const response = await fetch(`/setup/configuration/${provisioning.device_id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request), cache: "no-store" });
            if (!response.ok) { const error = await response.json(); setMessage(typeof error?.error?.message === "string" ? error.error.message : "Refresh setup before trying again."); router.refresh(); return; }
            const url = URL.createObjectURL(await response.blob()), link = document.createElement("a");
            link.href = url; link.download = "device-config.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
            setDownloaded(true); setMessage("Configuration downloaded. Keep this file private and install it with the matching firmware."); router.refresh();
          } catch { setMessage("The download could not be confirmed. Refresh setup; a lost handoff requires explicit replacement."); router.refresh(); }
        })}>{pending ? "Preparing download…" : "Download device configuration"}</button>
      </div> : <p className="text-muted">The handoff was downloaded, expired, or belongs to another sign-in session. Explicitly replace it if you need a fresh file.</p>}
      <div className="border-t border-hairline pt-5">
        <p className="text-sm text-muted">Replace configuration before reflashing an existing device or recovering a lost download. This immediately invalidates the previous credential and advances the upload sequence.</p>
        <label className="mt-3 flex items-start gap-3 text-sm"><input type="checkbox" checked={replaceConfirmed} disabled={pending} onChange={event => setReplaceConfirmed(event.target.checked)} className="mt-1" />I understand the previous configuration will stop working.</label>
        <button disabled={pending || !replaceConfirmed} className="mt-3 rounded-xl border border-hairline px-5 py-3 disabled:opacity-50" onClick={() => startTransition(async () => {
          requestId.current ??= crypto.randomUUID();
          const result = await replaceDeviceConfiguration(provisioning.device_id, { ...request, request_id: requestId.current });
          setMessage(result.ok ? "Configuration replaced. Download the new file before installing." : result.message);
          if (result.ok || result.refresh) router.refresh();
        })}>Replace configuration</button>
      </div>
      <details className="border-t border-hairline pt-5"><summary className="cursor-pointer text-sm">Stop this identity’s uploads permanently</summary>
        <p className="mt-3 text-sm text-muted">Revocation also cancels any outstanding download. This flow cannot reactivate a revoked identity.</p>
        <label className="mt-3 flex items-start gap-3 text-sm"><input type="checkbox" checked={revokeConfirmed} disabled={pending} onChange={event => setRevokeConfirmed(event.target.checked)} className="mt-1" />I want to revoke this device credential permanently.</label>
        <button disabled={pending || !revokeConfirmed} className="mt-3 rounded-xl border border-hairline px-5 py-3 disabled:opacity-50" onClick={() => startTransition(async () => {
          const result = await revokeDeviceCredential(provisioning.device_id, request);
          setMessage(result.ok ? "Device credential revoked." : result.message); if (result.ok || result.refresh) router.refresh();
        })}>Revoke device credential</button>
      </details>
    </>}
    <p role="status" className="text-sm text-muted">{message}</p>
  </section>;
}
