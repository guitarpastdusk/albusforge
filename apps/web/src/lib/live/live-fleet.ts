import type { DeviceStatusEvent, DeviceTile, Fleet, ReadingEvent } from "@albusforge/schema";
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
    // A reading can't be older than what the tile shows.
    if (tile.last_reading_at && Date.parse(event.t) < Date.parse(tile.last_reading_at)) return tile;
    const next: DeviceTile = { ...tile, status: "online", last_reading_at: event.t };
    if (tile.channel && tile.channel.key === event.channel) {
      const { value, unit } = formatChannelValue(tile.channel, event.v);
      next.value = value;
      next.unit = unit === "" ? null : unit;
    }
    return next;
  });
}

export function applyStatusToFleet(fleet: Fleet, event: DeviceStatusEvent): Fleet {
  return mapTile(fleet, event.device_id, (tile) => ({
    ...tile,
    status: event.status,
    last_reading_at: event.last_reading_at ?? tile.last_reading_at,
  }));
}

/** Recomputed from the tiles, so the header agrees with what's shown. */
export function onlineRatio(fleet: Fleet): number {
  const tiles = fleet.systems.flatMap((s) => s.devices).filter((d) => d.status !== "never_seen");
  if (tiles.length === 0) return fleet.stats.online_ratio;
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
