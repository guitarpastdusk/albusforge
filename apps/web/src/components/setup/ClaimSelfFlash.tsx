"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { claimSelfFlash } from "@/actions/device-provisioning";

export function ClaimSelfFlash({ tenantId, buildId, planVersion, codeVersion, mayWrite }: {
  tenantId: string; buildId: string; planVersion: number; codeVersion: number; mayWrite: boolean;
}) {
  const router = useRouter(), requestId = useRef<string | null>(null);
  const [pending, startTransition] = useTransition(), [message, setMessage] = useState("");
  return <section className="mt-8 rounded-[24px] border border-hairline bg-white p-6">
    <h2 className="font-display text-[28px]">Register a self-flash device</h2>
    <p className="mt-3 text-muted">Plan {planVersion} · firmware version {codeVersion}. This registers one device in your active workspace. Repeating this step reuses that plan’s registration.</p>
    <p className="mt-3 text-muted">Registration requires an accepted current plan and supported compiled firmware. Hardware profiles still awaiting approval cannot be provisioned.</p>
    {!mayWrite ? <p className="mt-3 text-muted">An operator or admin must register this device.</p> : <button disabled={pending} className="mt-5 rounded-xl bg-coral-deep px-5 py-3 font-medium text-white disabled:opacity-60" onClick={() => startTransition(async () => {
      requestId.current ??= crypto.randomUUID();
      const result = await claimSelfFlash({ expected_tenant_id: tenantId, build_id: buildId, plan_version: planVersion, code_version: codeVersion, request_id: requestId.current });
      if (result.ok) router.push(`/setup?device=${result.data.device_id}`); else setMessage(result.message);
    })}>{pending ? "Registering…" : "Register this device"}</button>}
    <p role="status" className="mt-3 text-sm text-muted">{message}</p>
    <Link href={`/projects/${buildId}`} className="mt-5 inline-block text-coral-deep">Return to the project workspace →</Link>
  </section>;
}
