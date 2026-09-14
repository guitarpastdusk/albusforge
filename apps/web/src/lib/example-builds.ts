import { PartDefinition, type Accent, type Listing, type ListingCategory, type ListingList, type ShowcaseCard } from "@albusforge/schema";
import knownIssuesJson from "../../../../registry/known-issues.json";
import c001 from "../../../../registry/parts/C-001/part.json";
import e001 from "../../../../registry/parts/E-001/part.json";
import e004 from "../../../../registry/parts/E-004/part.json";
import e005 from "../../../../registry/parts/E-005/part.json";
import l003 from "../../../../registry/parts/L-003/part.json";
import m001 from "../../../../registry/parts/M-001/part.json";
import p001 from "../../../../registry/parts/P-001/part.json";
import p002 from "../../../../registry/parts/P-002/part.json";
import p004 from "../../../../registry/parts/P-004/part.json";
import p005 from "../../../../registry/parts/P-005/part.json";
import v005 from "../../../../registry/parts/V-005/part.json";

/*
 * Example builds for the landing carousel and the Marketplace, shown while
 * gateway answers 501 for /v1/showcase and /v1/listings (not built yet).
 *
 * The designs are real: every build pins parts from the registry, read here
 * from the same part.json files registry-load puts in the database, and
 * example-builds.test.ts holds each one to the registry's own checks
 * (requirements met, distinct I2C addresses, a voltage-compatible power path).
 * What's sample data: the readings, their times, the authors and clone counts.
 */

/** The registry parts example builds use, parsed once at module load. */
export const EXAMPLE_PARTS: ReadonlyMap<string, PartDefinition> = new Map(
  [c001, e001, e004, e005, l003, m001, p001, p002, p004, p005, v005].map((json) => {
    const part = PartDefinition.parse(json);
    return [part.id, part];
  }),
);

/** A column in an example build's sample readings table. */
export interface SampleChannel {
  /** The part in the build that reads or drives it. */
  part: string;
  /** Its `read.*` or `act.*` capability; the unit comes from the suffix (`capabilityUnit`). */
  capability: string;
  /** Column heading. */
  label: string;
  /** Decimals for numeric values. Omit for values that are already text ("MOTION"). */
  precision?: number;
  /** One value per row, oldest first. Every channel in a build has the same count. */
  values: readonly (number | string)[];
}

export interface ExampleBuild {
  id: string;
  name: string;
  category: ListingCategory;
  accent: Accent;
  description: string;
  /** Sample data. */
  author: string;
  /** Sample data. */
  clones: number;
  parts: readonly { id: string; qty: number }[];
  /** The part that powers the brain, and the brain input it's wired to: `primary`, or one of the brain's `alt_inputs`. */
  power: { supply: string; brainInput: string };
  /** Sample data: the readings table on the listing page, and how far apart its rows are. */
  readings: { everySeconds: number; channels: readonly SampleChannel[] };
  /** On the landing carousel. The reading and its age are sample data. */
  showcase?: { reading: string; chain: readonly [string, string, string]; caption: string; secondsAgo: number };
}

export const EXAMPLE_BUILDS: readonly ExampleBuild[] = [
  {
    // Golden build: fridge monitor (registry/scripts/golden-builds.ts).
    id: "fridge-monitor",
    name: "Fridge monitor",
    category: "home",
    accent: "blue",
    description: "Temperature and humidity inside the fridge, door-open by tilt, on a rechargeable 18650 cell.",
    author: "tomek",
    clones: 143,
    parts: [
      { id: "C-001", qty: 1 },
      { id: "P-001", qty: 1 },
      { id: "P-004", qty: 1 },
      { id: "E-001", qty: 1 },
      { id: "E-004", qty: 1 },
    ],
    // The cell feeds the brain's 5V pin and onboard regulator, as the golden build does.
    power: { supply: "E-001", brainInput: "5v-pin" },
    readings: {
      everySeconds: 300,
      channels: [
        { part: "P-001", capability: "read.temperature_c", label: "Air temp", precision: 1, values: [3.6, 3.8, 4.1, 5.2, 4.4, 3.9] },
        { part: "P-001", capability: "read.humidity_pct", label: "Humidity", precision: 0, values: [61, 62, 63, 68, 65, 62] },
        { part: "P-004", capability: "read.acceleration_g", label: "Door tilt", precision: 2, values: [0.02, 0.02, 0.02, 0.98, 0.11, 0.02] },
      ],
    },
    showcase: { reading: "3.8°C", chain: ["BME280", "ESP32-S3", "Wi-Fi"], caption: "Temp + humidity · door by tilt", secondsAgo: 12 },
  },
  {
    // Golden build: presence alert.
    id: "presence-alert",
    name: "Presence alert",
    category: "home",
    accent: "peach",
    description: "PIR motion alert that stays quiet in daylight, using an ambient light sensor. Powered over USB-C.",
    author: "june",
    clones: 96,
    parts: [
      { id: "C-001", qty: 1 },
      { id: "L-003", qty: 1 },
      { id: "V-005", qty: 1 },
      { id: "E-005", qty: 1 },
    ],
    power: { supply: "E-005", brainInput: "primary" },
    readings: {
      everySeconds: 60,
      channels: [
        { part: "L-003", capability: "read.motion_bool", label: "Motion", values: ["clear", "clear", "MOTION", "MOTION", "clear", "clear"] },
        { part: "V-005", capability: "read.illuminance_lux", label: "Ambient light", precision: 0, values: [412, 396, 88, 74, 63, 55] },
      ],
    },
    showcase: { reading: "MOTION", chain: ["PIR", "ESP32-S3", "alert"], caption: "Motion · quiet in daylight", secondsAgo: 30 },
  },
  {
    // Golden build: plant waterer.
    id: "plant-waterer",
    name: "Plant waterer",
    category: "garden",
    accent: "green",
    description: "Reads soil moisture and turns a valve lever with a micro servo when the pot is dry. The decision runs on the device.",
    author: "maya",
    clones: 212,
    parts: [
      { id: "C-001", qty: 1 },
      { id: "P-005", qty: 1 },
      { id: "M-001", qty: 1 },
      { id: "V-005", qty: 1 },
      { id: "E-005", qty: 1 },
    ],
    power: { supply: "E-005", brainInput: "primary" },
    readings: {
      everySeconds: 600,
      channels: [
        { part: "P-005", capability: "read.soil_moisture_pct", label: "Soil", precision: 0, values: [38, 36, 35, 34, 41, 40] },
        { part: "M-001", capability: "act.position_deg", label: "Valve lever", precision: 0, values: [0, 0, 0, 90, 0, 0] },
        { part: "V-005", capability: "read.illuminance_lux", label: "Light", precision: 0, values: [820, 764, 690, 641, 583, 520] },
      ],
    },
    showcase: { reading: "34% soil", chain: ["soil probe", "ESP32-S3", "servo"], caption: "Waters when dry · on-device", secondsAgo: 40 },
  },
  {
    id: "greenhouse-soil-monitor",
    name: "Greenhouse soil monitor",
    category: "garden",
    accent: "green",
    description: "Four capacitive probes, one per bed, on a rechargeable 18650 cell. Readings every ten minutes.",
    author: "arvid",
    clones: 128,
    parts: [
      { id: "C-001", qty: 1 },
      { id: "P-005", qty: 4 },
      { id: "E-001", qty: 1 },
      { id: "E-004", qty: 1 },
    ],
    power: { supply: "E-001", brainInput: "5v-pin" },
    readings: {
      everySeconds: 600,
      channels: [
        { part: "P-005", capability: "read.soil_moisture_pct", label: "Bed 1", precision: 0, values: [33, 32, 32, 31, 31, 30] },
        { part: "P-005", capability: "read.soil_moisture_pct", label: "Bed 2", precision: 0, values: [41, 40, 40, 39, 38, 38] },
        { part: "P-005", capability: "read.soil_moisture_pct", label: "Bed 3", precision: 0, values: [28, 28, 27, 27, 26, 26] },
        { part: "P-005", capability: "read.soil_moisture_pct", label: "Bed 4", precision: 0, values: [36, 36, 35, 35, 34, 34] },
      ],
    },
    showcase: { reading: "31% soil", chain: ["soil probe ×4", "ESP32-S3", "Wi-Fi"], caption: "Four beds · battery powered", secondsAgo: 55 },
  },
  {
    id: "orchid-light-humidity",
    name: "Orchid light + humidity",
    category: "home",
    accent: "violet",
    description: "Light, humidity and temperature on the windowsill, so you know when the orchids need shade or misting.",
    author: "lena",
    clones: 61,
    parts: [
      { id: "C-001", qty: 1 },
      { id: "P-001", qty: 1 },
      { id: "V-005", qty: 1 },
      { id: "E-001", qty: 1 },
      { id: "E-004", qty: 1 },
    ],
    power: { supply: "E-001", brainInput: "5v-pin" },
    readings: {
      everySeconds: 300,
      channels: [
        { part: "V-005", capability: "read.illuminance_lux", label: "Light", precision: 0, values: [240, 265, 312, 420, 505, 561] },
        { part: "P-001", capability: "read.humidity_pct", label: "Humidity", precision: 0, values: [58, 59, 61, 62, 62, 63] },
        { part: "P-001", capability: "read.temperature_c", label: "Temp", precision: 1, values: [21.4, 21.5, 21.6, 21.8, 21.9, 22.0] },
      ],
    },
    showcase: { reading: "62% RH", chain: ["light + RH", "ESP32-S3", "Wi-Fi"], caption: "Light + humidity for orchids", secondsAgo: 8 },
  },
  {
    id: "compressor-vibration-watch",
    name: "Compressor vibration watch",
    category: "workshop",
    accent: "peach",
    description: "An accelerometer on the compressor housing tracks vibration and flags a drifting trend, an early sign of bearing wear.",
    author: "ines",
    clones: 77,
    parts: [
      { id: "C-001", qty: 1 },
      { id: "P-004", qty: 1 },
      { id: "E-005", qty: 1 },
    ],
    power: { supply: "E-005", brainInput: "primary" },
    readings: {
      everySeconds: 60,
      channels: [
        { part: "P-004", capability: "read.acceleration_g", label: "Vibration", precision: 2, values: [0.11, 0.12, 0.12, 0.13, 0.14, 0.14] },
        { part: "P-004", capability: "read.angular_rate_dps", label: "Rotation", precision: 1, values: [1.8, 1.9, 2.0, 2.1, 2.3, 2.4] },
      ],
    },
    showcase: { reading: "0.14 g", chain: ["MPU-6050", "ESP32-S3", "alert"], caption: "Vibration trend · bearing wear", secondsAgo: 5 },
  },
  {
    id: "garage-door-watch",
    name: "Garage door watch",
    category: "workshop",
    accent: "blue",
    description: "A tilt sensor on the door panel reports open or closed, and nudges you when it's left open after dark.",
    author: "sam",
    clones: 34,
    parts: [
      { id: "C-001", qty: 1 },
      { id: "P-004", qty: 1 },
      { id: "V-005", qty: 1 },
      { id: "E-005", qty: 1 },
    ],
    power: { supply: "E-005", brainInput: "primary" },
    readings: {
      everySeconds: 300,
      channels: [
        { part: "P-004", capability: "read.acceleration_g", label: "Panel tilt", precision: 2, values: [0.02, 0.02, 0.97, 0.98, 0.98, 0.98] },
        { part: "V-005", capability: "read.illuminance_lux", label: "Light", precision: 0, values: [96, 42, 18, 6, 3, 2] },
      ],
    },
  },
  {
    id: "cold-room-temperature-log",
    name: "Cold-room temperature log",
    category: "industrial",
    accent: "peach",
    description: "A waterproof probe inside the cold room logs temperature and alerts when it leaves the safe range.",
    author: "osei",
    clones: 52,
    parts: [
      { id: "C-001", qty: 1 },
      { id: "P-002", qty: 1 },
      { id: "E-005", qty: 1 },
    ],
    power: { supply: "E-005", brainInput: "primary" },
    readings: {
      everySeconds: 300,
      channels: [{ part: "P-002", capability: "read.temperature_c", label: "Cold-room temp", precision: 1, values: [2.1, 2.3, 2.6, 3.1, 3.4, 2.9] }],
    },
  },
];

const byId = new Map(EXAMPLE_BUILDS.map((build) => [build.id, build]));

function part(id: string): PartDefinition {
  const found = EXAMPLE_PARTS.get(id);
  if (!found) throw new Error(`example build uses ${id}, which isn't bundled in EXAMPLE_PARTS`);
  return found;
}

export interface ExamplePartLine {
  part: PartDefinition;
  qty: number;
  /** null when the registry has no price for the part yet. */
  lineCostUsd: number | null;
}

export interface ExampleBuildDetail {
  build: ExampleBuild;
  lines: ExamplePartLine[];
  /** Sum of the priced lines. */
  partsCostUsd: number;
  /** Lines the registry has no price for, so `partsCostUsd` is a lower bound. */
  unpricedLines: number;
  supply: PartDefinition;
  /** Registry known issues that apply to this combination of parts. */
  notes: string[];
}

const KNOWN_ISSUES = knownIssuesJson as ReadonlyArray<{ rule: string; parts: readonly string[]; note: string }>;

function detailOf(build: ExampleBuild): ExampleBuildDetail {
  const lines = build.parts.map(({ id, qty }) => {
    const found = part(id);
    const unit = found.commerce.unit_cost_usd;
    return { part: found, qty, lineCostUsd: unit === null ? null : Math.round(unit * qty * 100) / 100 };
  });
  const ids = new Set(build.parts.map((p) => p.id));
  const supply = part(build.power.supply);
  const brain = build.parts.map((p) => part(p.id)).find((p) => p.electrical.interface === "host");
  const notes = KNOWN_ISSUES.filter((issue) => issue.parts.every((id) => ids.has(id))).map((issue) => issue.note);
  // The registry checks voltage only; connector fit is still open (golden-builds.ts, ARCHITECTURE.md §18.1).
  if (brain && build.power.brainInput === "primary" && supply.electrical.connector !== brain.electrical.connector) {
    notes.push(
      `The ${supply.name}'s plug (${supply.electrical.connector}) doesn't fit the ${brain.name}'s port (${brain.electrical.connector}). You'll need an adapter cable, which isn't in the parts list.`,
    );
  }
  return {
    build,
    lines,
    partsCostUsd: Math.round(lines.reduce((sum, line) => sum + (line.lineCostUsd ?? 0), 0) * 100) / 100,
    unpricedLines: lines.filter((line) => line.lineCostUsd === null).length,
    supply,
    notes,
  };
}

export function exampleBuildDetail(id: string): ExampleBuildDetail | null {
  const build = byId.get(id);
  return build ? detailOf(build) : null;
}

const usd = (amount: number) => `$${Math.round(amount)}`;

function listingOf(build: ExampleBuild): Listing {
  const { partsCostUsd, unpricedLines } = detailOf(build);
  const cost = `${unpricedLines > 0 ? "From " : "About "}${usd(partsCostUsd)} in parts.`;
  return {
    id: build.id,
    name: build.name,
    category: build.category,
    accent: build.accent,
    description: `${build.description} ${cost}`,
    author: { handle: build.author },
    remix_count: build.clones,
  };
}

export function exampleListing(id: string): Listing | null {
  const build = byId.get(id);
  return build ? listingOf(build) : null;
}

const LISTING_PAGE = 12;

/** Like GET /v1/listings?tags=&cursor=: filtered by category before paging. */
export function exampleListings(tags: string | null, cursor: string | null = null, limit = LISTING_PAGE): ListingList {
  const wanted = tags?.split(",").filter(Boolean) ?? [];
  const matching = EXAMPLE_BUILDS.filter((build) => wanted.length === 0 || wanted.includes(build.category)).map(listingOf);
  const offset = cursor && /^\d+$/.test(cursor) ? Number(cursor) : 0;
  const end = offset + limit;
  return { listings: matching.slice(offset, end), next_cursor: end < matching.length ? String(end) : null };
}

/** Like GET /v1/showcase. Each card's id is its listing's id, so a card links to its build. */
export function exampleShowcase(now: Date = new Date()): ShowcaseCard[] {
  return EXAMPLE_BUILDS.flatMap((build) =>
    build.showcase
      ? [
          {
            id: build.id,
            name: build.name,
            accent: build.accent,
            reading: build.showcase.reading,
            chain: [...build.showcase.chain] as [string, string, string],
            caption: build.showcase.caption,
            last_reading_at: new Date(now.getTime() - build.showcase.secondsAgo * 1000).toISOString(),
          },
        ]
      : [],
  );
}
