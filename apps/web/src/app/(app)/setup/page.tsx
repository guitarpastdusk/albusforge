import { DeviceSetupParams, DeviceSetupStatus, routes } from "@albusforge/schema";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DeviceSetupView } from "@/components/setup/DeviceSetupView";
import { RefreshSetup } from "@/components/setup/RefreshSetup";
import { PageContainer, PageTitle } from "@/components/ui";
import { ApiRequestError } from "@/lib/api/core";
import { apiGet } from "@/lib/api/server";
import { signinHref } from "@/lib/next-path";
import { requireSession } from "@/lib/session";

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ device?: string | string[] }> }) {
  const search = await searchParams;
  const id = typeof search.device === "string" ? search.device : "";
  const destination = id ? `/setup?device=${encodeURIComponent(id)}` : "/setup";
  await requireSession(destination);
  let setup: DeviceSetupStatus | undefined;
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
      {setup ? <DeviceSetupView setup={setup} /> : null}
      {!setup ? <section className="mt-8 max-w-[760px] rounded-2xl bg-porcelain p-6" aria-labelledby="existing-registration">
        <h2 id="existing-registration" className="font-display text-[25px]">Start with an existing registration</h2>
        <p className="mt-3 text-muted">Choose a device from <Link href="/live" className="text-coral-deep underline">Live systems</Link> or use the ID supplied by your provisioner. This screen never needs its secret token.</p>
        <p className="mt-3 text-muted">New device enrollment, self-flash claim codes and guided flashing are not available yet. Contact your device provisioner for registration and firmware instructions. Entering a device ID here does not create or transfer a device.</p>
      </section> : null}
    </PageContainer>
  );
}
