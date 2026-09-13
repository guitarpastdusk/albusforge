import { Fleet, routes } from "@albusforge/schema";
import type { Metadata } from "next";
import { LiveFleet } from "@/components/devices/LiveFleet";
import { PageContainer } from "@/components/ui";
import { apiGet } from "@/lib/api/server";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Live systems" };

export default async function LiveSystemsPage() {
  // The session is GET /v1/me: its active tenant scopes the fleet and the stream.
  const me = await requireSession("/live");
  const fleet = await apiGet(routes.tenants.devices.path(me.tenant.id), Fleet);

  return (
    <PageContainer>
      <LiveFleet key={me.tenant.id} tenantId={me.tenant.id} fleet={fleet} initialNow={new Date().toISOString()} />
    </PageContainer>
  );
}
