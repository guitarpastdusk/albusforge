import { DeviceClaimRequest, DeviceProvisioning, DeviceSetupParams, DeviceSetupStatus, routes } from "@albusforge/schema";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ClaimSelfFlash } from "@/components/setup/ClaimSelfFlash";
import { DeviceConfiguration } from "@/components/setup/DeviceConfiguration";
import { DeviceSetupView } from "@/components/setup/DeviceSetupView";
import { RefreshSetup } from "@/components/setup/RefreshSetup";
import { PageContainer, PageTitle } from "@/components/ui";
import { ApiRequestError } from "@/lib/api/core";
import { apiGet } from "@/lib/api/server";
import { signinHref } from "@/lib/next-path";
import { requireSession } from "@/lib/session";

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ device?: string | string[]; build?: string | string[]; plan?: string | string[]; code?: string | string[] }> }) {
  const search = await searchParams;
  const id = typeof search.device === "string" ? search.device : "";
  const build = typeof search.build === "string" ? search.build : "";
  const plan = typeof search.plan === "string" ? search.plan : "", code = typeof search.code === "string" ? search.code : "";
  const destination = id ? `/setup?device=${encodeURIComponent(id)}` : build ? `/setup?build=${encodeURIComponent(build)}&plan=${encodeURIComponent(plan)}&code=${encodeURIComponent(code)}` : "/setup";
  const session = await requireSession(destination);
  const mayWrite = ["admin", "operator"].includes(session?.tenant.role);
  const claim = DeviceClaimRequest.pick({ build_id: true, plan_version: true, code_version: true }).safeParse({ build_id: build, plan_version: /^\d+$/.test(plan) ? Number(plan) : null, code_version: /^\d+$/.test(code) ? Number(code) : null });
  let setup: DeviceSetupStatus | undefined;
  let provisioning: DeviceProvisioning | undefined;
  let handoffUnavailable = false;
  let error: "invalid" | "unavailable" | "busy" | undefined;
  if (search.device !== undefined) {
    if (!DeviceSetupParams.safeParse({ id }).success) error = "invalid";
    else {
      try { setup = await apiGet(routes.deviceSetup.status.path(id), DeviceSetupStatus); }
      catch (failure) {
        if (!(failure instanceof ApiRequestError)) throw failure;
        if (failure.status === 401) redirect(signinHref(destination));
        if (failure.status === 403 || failure.status === 404) error = "unavailable";
        else if (failure.status === 503 || failure.status === 501) error = "busy";
        else throw failure;
      }
    }
  }
  if (setup) {
    try { provisioning = await apiGet(routes.deviceProvisioning.get.path(id), DeviceProvisioning); }
    catch (failure) {
      if (!(failure instanceof ApiRequestError)) throw failure;
      if (failure.status === 401) redirect(signinHref(destination));
      if (failure.status === 403 || failure.status === 404) { /* Existing paid/simulator registrations have no self-flash handoff. */ }
      else if (failure.status === 503 || failure.status === 501) handoffUnavailable = true;
      else throw failure;
    }
  }
  return (
    <PageContainer>
      <PageTitle kicker="Device setup" title="Confirm your first readings" description="Check cloud reception for a device already registered in your active workspace." />
      <form action="/setup" className="mt-7 flex flex-wrap items-end gap-3">
        <label className="grid w-full min-w-0 gap-2 text-sm font-medium sm:w-auto sm:flex-1">Registered device ID<input name="device" defaultValue={id} required placeholder="Device UUID" className="min-w-0 rounded-xl border border-hairline bg-white px-4 py-3 font-mono" /></label>
        <button className="rounded-xl bg-ink px-5 py-3 text-white">Check device</button>
      </form>
      {error ? <section role="alert" className="mt-6 rounded-2xl border border-hairline bg-white p-6">
        <h2 className="font-display text-[24px]">{error === "invalid" ? "Enter a valid device ID" : error === "unavailable" ? "Device unavailable" : "Setup status is temporarily unavailable"}</h2>
        <p className="mt-3 text-muted">{error === "invalid" ? "Use the full UUID shown in Live systems or provided with the registered device." : error === "unavailable" ? "This device is not available in the active workspace. Check the ID and workspace, or contact its provisioner." : "Try checking again shortly. This page cannot confirm reception until its status service responds."}</p>
        {error === "busy" ? <RefreshSetup waiting={false} /> : null}
      </section> : null}
      {claim.success && !id ? <ClaimSelfFlash key={`${session.tenant.id}:${build}:${plan}:${code}`} tenantId={session.tenant.id} buildId={claim.data.build_id} planVersion={claim.data.plan_version} codeVersion={claim.data.code_version} mayWrite={mayWrite} /> : null}
      {build && !claim.success && !id ? <p role="alert" className="mt-6 text-muted">Open setup from a compiled firmware version in the project workspace.</p> : null}
      {provisioning ? <DeviceConfiguration key={`${session.tenant.id}:${provisioning.device_id}:${provisioning.credential_version}:${provisioning.state}`} provisioning={provisioning} tenantId={session.tenant.id} mayWrite={mayWrite} /> : null}
      {handoffUnavailable ? <p role="status" className="mt-6 text-muted">Configuration status is temporarily unavailable. Check again before requesting a download or replacement.</p> : null}
      {setup ? <DeviceSetupView setup={setup} /> : null}
      {!setup ? <section className="mt-8 max-w-[760px] rounded-2xl bg-porcelain p-6" aria-labelledby="existing-registration">
        <h2 id="existing-registration" className="font-display text-[25px]">Start with an existing registration</h2>
        <p className="mt-3 text-muted">Choose a device from <Link href="/live" className="text-coral-deep underline">Live systems</Link> or use the ID supplied by your provisioner. This screen never needs its secret token.</p>
        <p className="mt-3 text-muted">For self-flash registration, open a compiled firmware version in your project workspace. It requires an accepted current plan and approved provisioning evidence. Paid-device registration remains with the provisioner. Entering a device ID here does not create or transfer a device.</p>
      </section> : null}
    </PageContainer>
  );
}
