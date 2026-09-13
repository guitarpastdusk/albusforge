import { DeviceDashboard, routes } from "@albusforge/schema";
import Link from "next/link";
import { ClosedLoopActions } from "@/components/devices/ClosedLoopActions";
import { DeviceChat } from "@/components/devices/DeviceChat";
import { LiveDashboard } from "@/components/devices/LiveDashboard";
import { PageContainer } from "@/components/ui";
import { apiGet, orNotFound } from "@/lib/api/server";
import { formatWhen } from "@/lib/format";
import { requireSession } from "@/lib/session";

export default async function DevicePage({ params }: { params: Promise<{ deviceId: string }> }) {
  const { deviceId } = await params;
  const me = await requireSession(`/live/${encodeURIComponent(deviceId)}`);
  const dashboard = await orNotFound(apiGet(routes.devices.dashboard.path(deviceId), DeviceDashboard));
  const { device } = dashboard;
  const now = new Date();
  const lastAction = dashboard.last_action ? `${dashboard.last_action.summary}, ${formatWhen(dashboard.last_action.at, now)}` : null;
  // Operator or admin on the device's tenant, resolved by gateway (ADR 0009). Absent means read-only.
  const canEdit = dashboard.permissions?.edit_actions ?? false;

  return (
    <PageContainer compact>
      <Link href="/live" className="text-[15px] text-muted hover:text-coral-deep">
        ← Live systems
      </Link>

      <LiveDashboard
        key={device.id}
        tenantId={me.tenant.id}
        dashboard={dashboard}
        initialNow={now.toISOString()}
        below={
          dashboard.actions || canEdit ? (
            <ClosedLoopActions key={device.id} deviceId={device.id} actions={dashboard.actions ?? []} lastAction={lastAction} canEdit={canEdit} />
          ) : null
        }
        aside={<DeviceChat deviceId={device.id} greeting={dashboard.greeting ?? `Hi — I’m ${device.name}. Ask me anything about my readings.`} />}
      />
    </PageContainer>
  );
}
