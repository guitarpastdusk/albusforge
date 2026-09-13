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
    limit: 50,
  });
  if (!query.success)
    return (
      <PageContainer>
        <h1 className="text-3xl">Invalid fleet cursor</h1>
        <Link href="/live">Return to the first page</Link>
      </PageContainer>
    );
  const params = new URLSearchParams({
    limit: "50",
    ...(query.data.after ? { after: query.data.after } : {}),
  });
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
          {query.data.after && (
            <input type="hidden" name="after" value={query.data.after} />
          )}
        </form>
      </div>
      <p className="text-muted mt-3">
        Stored telemetry for your active workspace. Status is checked on
        refresh; readings are not streamed.
      </p>
      {!fleet.devices.length ? (
        <p className="py-12">
          {query.data.after
            ? "No more devices on this page."
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
                Device {device.id}
              </Link>
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
        {query.data.after && <Link href="/live">First page</Link>}
        {fleet.next_after && (
          <Link href={`/live?after=${encodeURIComponent(fleet.next_after)}`}>
            Next page →
          </Link>
        )}
      </nav>
    </PageContainer>
  );
}
