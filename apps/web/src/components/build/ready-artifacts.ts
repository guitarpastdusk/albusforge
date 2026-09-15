import type { DeviceReadyCard } from "@albusforge/schema";
import { EXAMPLE_PARTS, type ExampleBuild } from "@/lib/example-builds";
import { exampleWiring, type Wiring } from "@/lib/example-wiring";

/*
 * What a finished design comes with, beside the parts list: the printed body,
 * the wiring, and the cloud workspace that receives its readings.
 *
 * The wiring is derived from the ready card's own part ids, so it is the real
 * diagram for the real parts. What the card cannot carry is quantity and the
 * power path — DeviceReadyCard has neither — so those come from a fixture here.
 * When the matcher (M3) writes a BuildPlan, the plan supplies both and this
 * fixture goes away; it is marked so nobody mistakes it for solved data.
 */

/** Quantity and power path the ready card has no field for. Fixture, not a plan. */
const ASSUMED = {
  qty: { "P-005": 4 } as Record<string, number>,
  power: { supply: "E-001", brainInput: "5v-pin" },
};

/** The wiring for a ready card, or null when its parts aren't registry parts. */
export function readyWiring(card: DeviceReadyCard): Wiring | null {
  const parts = card.parts.filter((part) => EXAMPLE_PARTS.has(part.part_id)).map((part) => ({ id: part.part_id, qty: ASSUMED.qty[part.part_id] ?? 1 }));
  // A brain and a supply are both required to draw anything at all.
  if (!parts.some(({ id }) => EXAMPLE_PARTS.get(id)!.electrical.interface === "host")) return null;
  if (!parts.some(({ id }) => id === ASSUMED.power.supply)) return null;
  const build = {
    id: "ready",
    name: card.name,
    category: "garden",
    accent: "green",
    description: card.name,
    author: "",
    clones: 0,
    parts,
    power: ASSUMED.power,
    readings: { everySeconds: 600, channels: [] },
  } as unknown as ExampleBuild;
  try {
    return exampleWiring(build);
  } catch {
    // exampleWiring throws when the parts cannot make a wiring. Say nothing
    // rather than draw a diagram we cannot stand behind.
    return null;
  }
}

/** What the device will send once it is running, read from the spec's capabilities. */
const CHANNEL_LABEL: Record<string, string> = {
  "read.soil_moisture_pct": "soil moisture %",
  "read.temperature_c": "temperature °C",
  "read.humidity_pct": "humidity %",
  "read.pressure_hpa": "pressure hPa",
  "read.lux": "light (lux)",
  "read.acceleration_g": "movement (g)",
  "read.distance_mm": "distance (mm)",
  "read.presence": "presence",
};

export interface CloudWorkspace {
  /** The channels the device will publish, in spec order. */
  channels: string[];
  /** How often it reports, when the spec says. */
  everySeconds: number | null;
}

export function cloudWorkspace(spec: Record<string, unknown> | null): CloudWorkspace {
  const sense = (spec as { sense?: { interval_s?: unknown } } | null)?.sense;
  const capabilities = Array.isArray((spec as { capabilities?: unknown } | null)?.capabilities)
    ? ((spec as { capabilities: unknown[] }).capabilities.filter((c): c is string => typeof c === "string"))
    : [];
  return {
    channels: capabilities.filter((c) => c.startsWith("read.")).map((c) => CHANNEL_LABEL[c] ?? c),
    everySeconds: typeof sense?.interval_s === "number" && sense.interval_s > 0 ? sense.interval_s : null,
  };
}

/** "every 10 minutes", "every 30 seconds". */
export function cadence(everySeconds: number): string {
  if (everySeconds % 3600 === 0) return `every ${everySeconds / 3600} hour${everySeconds === 3600 ? "" : "s"}`;
  if (everySeconds % 60 === 0) return `every ${everySeconds / 60} minute${everySeconds === 60 ? "" : "s"}`;
  return `every ${everySeconds} second${everySeconds === 1 ? "" : "s"}`;
}
