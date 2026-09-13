import type { DeviceTile } from "@albusforge/schema";
import { PulseDot } from "@/components/ui/PulseDot";
import { AWAITING_FIRST_READING, formatAgo } from "@/lib/format";

/** The inside of a Live systems tile. The page supplies the link and accent colours. */
export function DeviceTileBody({ device, now }: { device: DeviceTile; now: Date }) {
  const valueAt = device.value_at === undefined ? device.last_reading_at : device.value_at;
  const neverSeen = device.status === "never_seen" || device.last_reading_at === null;

  return (
    <>
      <span className="flex items-center gap-2 text-[15px] font-semibold">
        {!neverSeen && device.status === "online" ? <PulseDot size={9} /> : null}
        {device.name}
      </span>
      {neverSeen || valueAt === null ? (
        <>
          <span className="font-mono text-[15px] leading-[29px]">{AWAITING_FIRST_READING}</span>
          <span className="text-[13px] opacity-75">{device.metric}</span>
        </>
      ) : (
        <>
          <span className="font-mono text-[24px]">
            {device.value ?? "—"}
            {device.unit ? <span className="text-[15px] opacity-70"> {device.unit}</span> : null}
          </span>
          <span className="text-[13px] opacity-75">
            {device.metric} · {formatAgo(valueAt, now)}
          </span>
        </>
      )}
    </>
  );
}
