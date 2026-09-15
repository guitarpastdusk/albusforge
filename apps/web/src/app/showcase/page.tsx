import { TelemetryFleetQuery } from "@albusforge/schema";
import type { Metadata } from "next";
import Link from "next/link";
import { PageContainer } from "@/components/ui";
import { PublicNotice } from "@/components/showcase/PublicNotice";
import { publicLive } from "@/lib/api/public-live";
import type { Search } from "@/lib/telemetry-monitor";

export const metadata: Metadata = { title: "Live demo" };

/**
 * The public fleet: the same devices their owner sees, readable without signing
 * in. Which tenant that is comes from the gateway's configuration, not from
 * anything here — there is no parameter on this page that could select one.
 */
export default async function ShowcasePage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const query = TelemetryFleetQuery.safeParse({
    after: search.after,
    q: search.q,
    status: search.status === "all" ? undefined : search.status,
    presentation: "1",
    limit: 50,
  });
  if (!query.success)
    return (
      <PageContainer>
        <h1 className="font-display text-[32px]">Invalid filters</h1>
        <Link href="/showcase" className="text-coral-deep">Return to the first page</Link>
      </PageContainer>
    );

  const params = new URLSearchParams({
    limit: "50",
    presentation: "1",
    ...(query.data.q ? { q: query.data.q } : {}),
    ...(query.data.status ? { status: query.data.status } : {}),
    ...(query.data.after ? { after: query.data.after } : {}),
  });
  const filterParams = new URLSearchParams({
    ...(query.data.q ? { q: query.data.q } : {}),
    ...(query.data.status ? { status: query.data.status } : {}),
  });

  // The gateway registers this surface only when it has a showcase tenant. If
  // the pill is switched on before that config lands — or after it is removed —
  // a visitor gets a page that explains itself rather than a 500.
  const fleet = await publicLive.fleet(params).catch(() => null);
  if (!fleet)
    return (
      <PageContainer>
        <p className="font-mono text-[13px] uppercase tracking-[0.2em] text-coral-deep">Live demo</p>
        <h1 className="mt-3 font-display text-[clamp(28px,3vw,38px)] font-medium">Not available right now</h1>
        <p className="mt-4 max-w-[560px] text-[17px] font-light leading-[1.5] text-muted">
          No live systems are being shown publicly at the moment. Nothing is wrong with your link.
        </p>
        <Link href="/" className="mt-6 inline-block text-coral-deep">Back to Albus Forge →</Link>
      </PageContainer>
    );

  return (
    <PageContainer>
      <p className="font-mono text-[13px] uppercase tracking-[0.2em] text-coral-deep">Live demo</p>
      <h1 className="mt-3 font-display text-[clamp(28px,3vw,38px)] font-medium">Systems running right now</h1>
      <PublicNotice />

      <form className="mt-8 flex flex-wrap items-end gap-4">
        <label className="grid min-w-0 flex-1 gap-2 text-[14px] text-muted">
          Search name or device ID
          <input type="search" name="q" maxLength={80} defaultValue={query.data.q ?? ""} className="min-w-0 rounded-xl border border-hairline bg-white px-4 py-3 text-[16px] text-ink" />
        </label>
        <label className="grid gap-2 text-[14px] text-muted">
          Status
          <select name="status" defaultValue={query.data.status ?? "all"} className="rounded-xl border border-hairline bg-white px-4 py-3 text-[16px] text-ink">
            <option value="all">All statuses</option>
            <option value="online">Online</option>
            <option value="offline">Offline</option>
            <option value="never_seen">Awaiting first upload</option>
            <option value="revoked">Credential revoked</option>
          </select>
        </label>
        <button className="rounded-xl bg-coral-deep px-5 py-3 text-[16px] text-white">Apply filters</button>
        <Link href="/showcase" className="px-3 py-3 text-[15px] text-muted">Clear</Link>
      </form>

      {!fleet.devices.length ? (
        <p className="py-12 text-muted">
          {query.data.after
            ? "No more devices on this page."
            : query.data.q || query.data.status
              ? "No devices match these filters."
              : "No devices are being shown here yet."}
        </p>
      ) : (
        <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {fleet.devices.map((device) => (
            <li key={device.id} className="rounded-2xl border border-hairline bg-white p-5">
              <Link href={`/showcase/${device.id}`} className="block break-all font-medium text-ink underline decoration-hairline hover:text-coral-deep">
                {device.display_name ?? `Device ${device.id}`}
              </Link>
              {device.display_name && <p className="mt-2 break-all text-[12px] text-faint">ID {device.id}</p>}
              <p className="mt-3 text-[15px]">
                {device.revoked_at
                  ? "Credential revoked"
                  : device.status === "never_seen"
                    ? "Awaiting first upload"
                    : device.status === "online"
                      ? "Online"
                      : "Offline"}
              </p>
              <p className="mt-2 text-[14px] text-muted">Last packet: {device.last_seen_at ?? "never"}</p>
            </li>
          ))}
        </ul>
      )}

      <nav aria-label="Pages" className="mt-8 flex gap-6">
        {query.data.after && <Link href={`/showcase?${filterParams}`} className="text-coral-deep">First page</Link>}
        {fleet.next_after && (
          <Link href={`/showcase?${filterParams}&after=${encodeURIComponent(fleet.next_after)}`} className="text-coral-deep">Next page →</Link>
        )}
      </nav>
    </PageContainer>
  );
}
