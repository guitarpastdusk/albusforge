import type { DeviceDashboard, DeviceStatus } from "@albusforge/schema";
import { Kicker, type KickerTone } from "@/components/ui/Kicker";
import { PulseDot } from "@/components/ui/PulseDot";
import { formatDeviceStatus, isAwaitingFirstReading } from "@/lib/format";

const TONE: Record<DeviceStatus, KickerTone> = {
  online: "success",
  offline: "coral",
  never_seen: "muted",
};

/** Status line and name at the top of the device dashboard. */
export function DeviceStatusHeader({ device, now }: { device: DeviceDashboard["device"]; now: Date }) {
  const awaiting = isAwaitingFirstReading(device);

  return (
    <div>
      <div className="flex items-center gap-2.5">
        {!awaiting && device.status === "online" ? <PulseDot size={10} /> : null}
        <Kicker tone={awaiting ? "muted" : TONE[device.status]} tracking={0.16}>
          {formatDeviceStatus(device, now)}
        </Kicker>
      </div>
      <h1 className="mt-2.5 font-display text-[44px] font-medium tracking-[-0.01em]">{device.name}</h1>
    </div>
  );
}
