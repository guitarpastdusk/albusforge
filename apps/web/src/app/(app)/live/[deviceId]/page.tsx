import { DeviceDashboard, routes } from "@albusforge/schema";
import Link from "next/link";
import { ClosedLoopActions } from "@/components/devices/ClosedLoopActions";
import { DeviceChat } from "@/components/devices/DeviceChat";
import { DeviceStatusHeader } from "@/components/devices/DeviceStatusHeader";
import { DeviceWidgets } from "@/components/devices/DeviceWidgets";
import { PageContainer, Pill } from "@/components/ui";
import { apiGet, orNotFound } from "@/lib/api/server";
import { formatWhen } from "@/lib/format";
import { requireSession } from "@/lib/session";

export default async function DevicePage({ params }: { params: Promise<{ deviceId: string }> }) {
  const { deviceId } = await params;
  await requireSession(`/live/${encodeURIComponent(deviceId)}`);
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

      <div className="mt-[18px] flex flex-wrap items-end justify-between gap-6">
        <DeviceStatusHeader device={device} now={now} />
        <ul className="flex flex-wrap gap-2">
          {device.chips.map((chip) => (
            <li key={chip.label}>
              <Pill accent={chip.accent} className="px-[18px] py-2 text-[14px]">
                {chip.label}
              </Pill>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-[30px] grid items-start gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <DeviceWidgets dashboard={dashboard} />
          {/* Shown when the device has rules, or the session may add the first one. */}
          {dashboard.actions || canEdit ? (
            <ClosedLoopActions deviceId={device.id} actions={dashboard.actions ?? []} lastAction={lastAction} canEdit={canEdit} />
          ) : null}
        </div>
        <DeviceChat
          deviceId={device.id}
          greeting={dashboard.greeting ?? `Hi — I’m ${device.name}. Ask me anything about my readings.`}
        />
      </div>
    </PageContainer>
  );
}
