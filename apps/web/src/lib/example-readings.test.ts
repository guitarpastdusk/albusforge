import { describe, expect, it } from "vitest";
import { capabilityUnit } from "../../../../registry/scripts/lib/units";
import { EXAMPLE_BUILDS, EXAMPLE_PARTS } from "./example-builds";
import { cadenceOf, exampleReadings, SAMPLE_READINGS_END } from "./example-readings";

describe.each(EXAMPLE_BUILDS.map((build) => [build.id, build] as const))("%s sample readings", (_id, build) => {
  const { columns, rows, cadence } = exampleReadings(build);

  it("has a column per channel, read or driven by a part the build pins", () => {
    expect(columns).toHaveLength(build.readings.channels.length);
    for (const column of columns) {
      expect(build.parts.map(({ id }) => id), column.label).toContain(column.part.id);
      expect(column.part.software.capabilities, column.label).toContain(column.capability);
    }
  });

  it("labels each column with the unit the capability carries", () => {
    for (const [index, column] of columns.entries()) {
      const values = build.readings.channels[index]!.values;
      // Text values ("MOTION") read as themselves; everything else carries its capability's unit.
      expect(column.unit).toBe(values.some((value) => typeof value === "string") ? "" : capabilityUnit(column.capability));
    }
  });

  it("samples every channel on the same clock, oldest row first, ending at the sample window's end", () => {
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.at(-1)!.at).toBe(SAMPLE_READINGS_END);
    for (const [index, row] of rows.entries()) {
      expect(row.cells).toHaveLength(columns.length);
      if (index === 0) continue;
      expect(Date.parse(row.at) - Date.parse(rows[index - 1]!.at)).toBe(build.readings.everySeconds * 1000);
    }
    expect(cadence).toBe(cadenceOf(build.readings.everySeconds));
  });

  it("shows the time in UTC, with the machine-readable instant beside it", () => {
    for (const row of rows) {
      expect(row.at).toMatch(/Z$/);
      expect(row.when).toBe(`${row.at.slice(0, 10)} ${row.at.slice(11, 19)} UTC`);
    }
  });

  it("formats every value at the channel's precision", () => {
    for (const [index, channel] of build.readings.channels.entries()) {
      for (const [row, value] of channel.values.entries()) {
        expect(rows[row]!.cells[index]).toBe(typeof value === "string" ? value : value.toFixed(channel.precision ?? 0));
      }
    }
  });
});

describe("sample readings", () => {
  it("reads the cadence in the unit that fits", () => {
    expect(cadenceOf(30)).toBe("30s");
    expect(cadenceOf(300)).toBe("5 min");
    expect(cadenceOf(7200)).toBe("2 h");
  });

  it("refuses a build whose channels disagree on how many samples there are", () => {
    const build = EXAMPLE_BUILDS.find((b) => b.id === "fridge-monitor")!;
    const ragged = { ...build, readings: { ...build.readings, channels: [build.readings.channels[0]!, { ...build.readings.channels[1]!, values: [1] }] } };
    expect(() => exampleReadings(ragged)).toThrow(/same number of values/);
  });

  it("refuses a channel no part in the build provides", () => {
    const build = EXAMPLE_BUILDS.find((b) => b.id === "cold-room-temperature-log")!;
    const wrong = { ...build, readings: { ...build.readings, channels: [{ ...build.readings.channels[0]!, capability: "read.illuminance_lux" }] } };
    expect(() => exampleReadings(wrong)).toThrow(/has no read.illuminance_lux/);
  });

  it("a text channel keeps its own words; a numeric one gets its unit in the heading", () => {
    const { columns, rows } = exampleReadings(EXAMPLE_BUILDS.find((b) => b.id === "presence-alert")!);
    expect(columns.map(({ label, unit }) => `${label} ${unit}`.trim())).toEqual(["Motion", "Ambient light lx"]);
    expect(rows.map((row) => row.cells[0])).toContain("MOTION");
    expect(EXAMPLE_PARTS.get(columns[0]!.part.id)!.software.capabilities).toContain("read.motion_bool");
  });
});
