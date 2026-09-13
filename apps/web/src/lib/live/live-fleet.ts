import type { Channel, DeviceStatusEvent, DeviceTile, Fleet, ReadingEvent } from "@albusforge/schema";
import { formatChannelValue } from "@/lib/format";

/*
 * Applying stream events to the Live systems fleet (CLOUD-PLATFORM.md §6.2).
 * Pure: the snapshot from GET /v1/tenants/:id/devices plus events in, a fleet
 * out. A tile's value is a preformatted string, so a reading is formatted the
 * same way gateway did, using the tile's `channel`; a tile without one, or a
 * reading on another channel, updates only the age and status.
 */

export function applyReadingToFleet(fleet: Fleet, event: ReadingEvent): Fleet {
  return mapTile(fleet, event.device_id, (tile) => {
    const matches = tile.channel?.key === event.channel;
    if (matches && !acceptsValue(tile.channel!, event.v)) return tile;
    const valueAt = tile.value_at === undefined ? tile.last_reading_at : tile.value_at;
    const newerDevice = !tile.last_reading_at || Date.parse(event.t) > Date.parse(tile.last_reading_at);
    const newerValue = matches && (!valueAt || Date.parse(event.t) > Date.parse(valueAt));
    if (!newerDevice && !newerValue) return tile;
    const next: DeviceTile = { ...tile, value_at: valueAt };
    if (newerDevice) {
      if (!tile.status_at || Date.parse(event.t) > Date.parse(tile.status_at)) {
        next.status = "online";
        next.status_at = event.t;
      }
      next.last_reading_at = event.t;
    }
    if (newerValue) {
      const { value, unit } = formatChannelValue(tile.channel!, event.v);
      next.value = value;
      next.unit = unit === "" ? null : unit;
      next.value_at = event.t;
    }
    return next;
  });
}

export function applyStatusToFleet(fleet: Fleet, event: DeviceStatusEvent): Fleet {
  return mapTile(fleet, event.device_id, (tile) => {
    const observed = tile.status_at ?? tile.last_reading_at;
    if (observed && Date.parse(event.at) <= Date.parse(observed)) return tile;
    return {
      ...tile,
      value_at: tile.value_at === undefined ? tile.last_reading_at : tile.value_at,
      status: event.status,
      status_at: event.at,
      last_reading_at: laterTime(tile.last_reading_at, event.last_reading_at),
    };
  });
}

/** Recomputed from the tiles, so the header agrees with what's shown. */
export function onlineRatio(fleet: Fleet): number {
  const tiles = fleet.systems.flatMap((s) => s.devices).filter((d) => d.status !== "never_seen");
  if (tiles.length === 0) return 0;
  return tiles.filter((d) => d.status === "online").length / tiles.length;
}

function mapTile(fleet: Fleet, deviceId: string, update: (tile: DeviceTile) => DeviceTile): Fleet {
  let changed = false;
  const systems = fleet.systems.map((system) => {
    const devices = system.devices.map((tile) => {
      if (tile.id !== deviceId) return tile;
      const next = update(tile);
      if (next !== tile) changed = true;
      return next;
    });
    return { ...system, devices };
  });
  return changed ? { ...fleet, systems, stats: { ...fleet.stats, online_ratio: onlineRatio({ ...fleet, systems }) } } : fleet;
}

export function laterTime(a: string | null, b: string | null): string | null {
  return !a ? b : !b || Date.parse(a) >= Date.parse(b) ? a : b;
}

export function acceptsValue(channel: Channel, value: number | string): boolean {
  return channel.kind === "status" ? typeof value === "string" : typeof value === "number" && Number.isFinite(value);
}

/** Fresh metadata/membership wins; keep readings newer than the incoming snapshot. */
export function mergeFleetSnapshot(snapshot: Fleet, current: Fleet): Fleet {
  const previous = new Map(current.systems.flatMap((s) => s.devices).map((d) => [d.id, d]));
  const systems = snapshot.systems.map((system) => ({
    ...system,
    devices: system.devices.map((tile) => {
      const old = previous.get(tile.id);
      if (!old) return tile;
      const next = { ...tile, value_at: tile.value_at === undefined ? tile.last_reading_at : tile.value_at };
      if (old.last_reading_at && (!tile.last_reading_at || Date.parse(old.last_reading_at) > Date.parse(tile.last_reading_at))) {
        next.last_reading_at = old.last_reading_at;
      }
      const oldStatusAt = old.status_at ?? old.last_reading_at;
      const newStatusAt = tile.status_at ?? tile.last_reading_at;
      if (oldStatusAt && (!newStatusAt || Date.parse(oldStatusAt) > Date.parse(newStatusAt))) {
        next.status = old.status;
        next.status_at = oldStatusAt;
      }
      const oldAt = old.value_at === undefined ? old.last_reading_at : old.value_at;
      const newAt = tile.value_at === undefined ? tile.last_reading_at : tile.value_at;
      if (JSON.stringify(old.channel) === JSON.stringify(tile.channel) && oldAt && (!newAt || Date.parse(oldAt) > Date.parse(newAt))) {
        next.value = old.value;
        next.unit = old.unit;
        next.value_at = oldAt;
      }
      return next;
    }),
  }));
  const result = { ...snapshot, systems };
  return { ...result, stats: { ...result.stats, online_ratio: onlineRatio(result) } };
}
