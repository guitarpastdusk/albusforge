import type { PartDefinition } from "@albusforge/schema";
import { capabilityUnit } from "../../../../registry/scripts/lib/units";
import { EXAMPLE_PARTS, type ExampleBuild } from "./example-builds";
import { formatChannelValue } from "./format";

/*
 * An example build's sample readings, as the listing page tables them.
 *
 * The columns are real: each one is a `read.*` or `act.*` capability of a part
 * the build pins, and its unit comes from the capability's suffix, the one
 * place units are written down (registry/scripts/lib/units.ts). The values and
 * their times are sample data, authored per build in example-builds.ts.
 *
 * The window ends at a fixed instant rather than `now`, so the table is the
 * same on the server and in the browser, and doesn't quietly age.
 */

/** The most recent sample row's time. */
export const SAMPLE_READINGS_END = "2026-09-13T09:00:00.000Z";

export interface ReadingColumn {
  label: string;
  /** From the capability suffix; "" when the values carry their own meaning ("MOTION"). */
  unit: string;
  part: PartDefinition;
  capability: string;
}

export interface ReadingRow {
  /** ISO 8601, UTC. */
  at: string;
  /** "2026-09-13 08:45:00 UTC". */
  when: string;
  /** One per column, formatted with its unit. */
  cells: string[];
}

export interface SampleReadings {
  columns: ReadingColumn[];
  rows: ReadingRow[];
  /** How far apart the rows are: "5 min", "60s". */
  cadence: string;
}

/** "60s" under a minute, "5 min" under an hour, "2 h" above. */
export function cadenceOf(everySeconds: number): string {
  if (everySeconds < 60) return `${everySeconds}s`;
  if (everySeconds < 3600) return `${everySeconds / 60} min`;
  return `${everySeconds / 3600} h`;
}

/** "2026-09-13 08:45:00 UTC" — UTC, so the table doesn't depend on who renders it. */
export function formatUtc(at: string): string {
  return `${at.slice(0, 10)} ${at.slice(11, 19)} UTC`;
}

function partOf(id: string): PartDefinition {
  const found = EXAMPLE_PARTS.get(id);
  if (!found) throw new Error(`sample readings use ${id}, which isn't bundled in EXAMPLE_PARTS`);
  return found;
}

/**
 * The build's sample readings table: a column per channel, a row per sample,
 * oldest first, ending at `SAMPLE_READINGS_END`.
 */
export function exampleReadings(build: ExampleBuild): SampleReadings {
  const { everySeconds, channels } = build.readings;
  const rowCount = channels[0]?.values.length ?? 0;
  if (channels.some((channel) => channel.values.length !== rowCount)) {
    throw new Error(`${build.id}: every sample channel needs the same number of values`);
  }

  const columns = channels.map((channel): ReadingColumn => {
    const part = partOf(channel.part);
    if (!part.software.capabilities.includes(channel.capability)) {
      throw new Error(`${build.id}: ${part.id} has no ${channel.capability}`);
    }
    // A text value ("MOTION") reads as itself; `read.motion_bool`'s "true/false" isn't a unit to print.
    const unit = channel.values.some((value) => typeof value === "string") ? "" : (capabilityUnit(channel.capability) ?? "");
    return { label: channel.label, unit, part, capability: channel.capability };
  });

  const end = Date.parse(SAMPLE_READINGS_END);
  const rows = Array.from({ length: rowCount }, (_row, index): ReadingRow => {
    const at = new Date(end - (rowCount - 1 - index) * everySeconds * 1000).toISOString();
    return {
      at,
      when: formatUtc(at),
      // The unit sits in the column heading, so a cell is the value at its display precision.
      cells: channels.map((channel) => {
        const value = channel.values[index]!;
        const kind = typeof value === "string" ? "status" : "number";
        return formatChannelValue({ kind, precision: channel.precision ?? 0, unit: "" }, value).value;
      }),
    };
  });

  return { columns, rows, cadence: cadenceOf(everySeconds) };
}
