import {
  TelemetryFleetPage,
  TelemetryFleetQuery,
  routes,
} from "@albusforge/schema";
import type { Metadata } from "next";
import Link from "next/link";
import { PageContainer } from "@/components/ui";
import { apiGet } from "@/lib/api/server";
import { requireSession } from "@/lib/session";
import type { Search } from "@/lib/telemetry-monitor";

export const metadata: Metadata = { title: "Live systems" };
export default async function LiveSystemsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  await requireSession("/live");
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
        <h1 className="text-3xl">Invalid fleet filters</h1>
        <Link href="/live">Return to the first page</Link>
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
  const firstPage = `/live?${filterParams}`;
  const fleet = await apiGet(
    `${routes.telemetry.devices.path()}?${params}`,
    TelemetryFleetPage,
  );
  return (
    <PageContainer>
      <div className="flex justify-between items-center gap-4">
        <h1 className="text-3xl font-semibold">Live systems</h1>
        <form>
          <button className="rounded-full border px-5 py-2">
            Refresh fleet
          </button>
          {query.data.q && (
            <input type="hidden" name="q" value={query.data.q} />
          )}
          {query.data.status && (
            <input type="hidden" name="status" value={query.data.status} />
          )}
          {query.data.after && (
            <input type="hidden" name="after" value={query.data.after} />
          )}
        </form>
      </div>
      <p className="text-muted mt-3">
        Stored telemetry for your active workspace. Status is checked on
        refresh; readings are not streamed.
      </p>
      <form className="mt-6 flex flex-wrap items-end gap-4">
        <label className="grid gap-2 min-w-0 flex-1">
          Search name or device ID
          <input
            type="search"
            name="q"
            maxLength={80}
            defaultValue={query.data.q ?? ""}
            className="min-w-0 rounded-xl border border-hairline px-4 py-3"
          />
        </label>
        <label className="grid gap-2">
          Status
          <select
            name="status"
            defaultValue={query.data.status ?? "all"}
            className="rounded-xl border border-hairline px-4 py-3"
          >
            <option value="all">All statuses</option>
            <option value="online">Online</option>
            <option value="offline">Offline</option>
            <option value="never_seen">Awaiting first upload</option>
            <option value="revoked">Credential revoked</option>
          </select>
        </label>
        <button className="rounded-xl bg-coral-deep px-5 py-3 text-white">
          Apply filters
        </button>
        <Link href="/live" className="px-3 py-3">
          Clear filters
        </Link>
      </form>
      <p className="mt-4 text-sm text-muted">
        Showing {fleet.devices.length} devices on this page. Search and status
        changes start at the first page; counts are not fleet totals.
      </p>
      {!fleet.devices.length ? (
        <p className="py-12">
          {query.data.after
            ? "No more devices on this page."
            : query.data.q || query.data.status
              ? "No devices match these filters. Try another name, device ID or status."
              : "No devices provisioned yet. Once a device is provisioned for this workspace, it will appear here."}
        </p>
      ) : (
        <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 mt-8">
          {fleet.devices.map((device) => (
            <li
              key={device.id}
              className="rounded-2xl border border-current/10 p-5"
            >
              <Link
                href={`/live/${device.id}`}
                className="block font-medium break-all underline decoration-current/20"
              >
                {device.display_name ?? `Device ${device.id}`}
              </Link>
              {device.display_name && (
                <p className="text-xs text-muted mt-2 break-all">
                  ID {device.id}
                </p>
              )}
              <p className="mt-3">
                {device.revoked_at
                  ? "Credential revoked"
                  : device.status === "never_seen"
                    ? "Awaiting first upload"
                    : device.status === "online"
                      ? "Online"
                      : "Offline"}
              </p>
              <p className="text-sm text-muted mt-2">
                Last packet: {device.last_seen_at ?? "never"}
              </p>
            </li>
          ))}
        </ul>
      )}
      <nav aria-label="Fleet pages" className="flex gap-6 mt-8">
        {query.data.after && <Link href={firstPage}>First page</Link>}
        {fleet.next_after && (
          <Link
            href={`/live?${filterParams}&after=${encodeURIComponent(fleet.next_after)}`}
          >
            Next page →
          </Link>
        )}
      </nav>
    </PageContainer>
  );
}
