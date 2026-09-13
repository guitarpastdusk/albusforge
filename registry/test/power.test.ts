import { describe, expect, it } from "vitest";
import { GOLDEN_BUILDS } from "../scripts/golden-builds";
import { loadParts } from "../scripts/lib/load";
import { checkPowerPath, usableWindow } from "../scripts/lib/power";

/** The committed registry's live parts: what the matcher could pick today. */
const live = loadParts().filter((p) => p.status === "draft" || p.status === "active");
const build = (id: string) => GOLDEN_BUILDS.find((b) => b.id === id)!;

describe("usableWindow", () => {
  it("is the overlap when the source stays at or under the input's maximum", () => {
    expect(usableWindow([2.5, 4.2], [3.68, 5.5])).toEqual([3.68, 4.2]);
    expect(usableWindow([4.845, 5.355], [4.13, 5.5])).toEqual([4.845, 5.355]);
  });

  it("is null when the source can exceed the input's maximum", () => {
    expect(usableWindow([2.5, 4.2], [3.0, 3.6])).toBeNull();
    expect(usableWindow([4.845, 5.355], [5.0, 5.0])).toBeNull();
  });

  it("is null when the windows don't meet", () => {
    expect(usableWindow([1.0, 2.0], [3.0, 5.0])).toBeNull();
  });
});

describe("golden-build power paths on the committed registry", () => {
  it.each(GOLDEN_BUILDS.map((b) => [b.name, b] as const))("%s has a voltage-compatible assignment", (_, golden) => {
    const result = checkPowerPath(golden, live);
    expect(result.ok ? [] : result.problems).toEqual([]);
  });

  it("fridge monitor: the cell feeds C-001's 5V pin regulator, with sensors on its 3.3 V rail", () => {
    expect(checkPowerPath(build("fridge-monitor"), live)).toEqual({
      ok: true,
      assignment: {
        supply: "E-001",
        brain: "C-001",
        brain_input: "5v-pin",
        // Below 3.68 V the regulator drops out: the power math has to use this, not the cell's 2.5–4.2 V.
        window: [3.68, 4.2],
        peripherals: [
          { capability: "read.temperature_c", part: "P-001", rail: "C-001 rail", window: [3.251, 3.349] },
          { capability: "read.humidity_pct", part: "P-001", rail: "C-001 rail", window: [3.251, 3.349] },
        ],
      },
    });
  });

  it("presence alert: the USB supply feeds C-001's USB input and the PIR directly", () => {
    expect(checkPowerPath(build("presence-alert"), live)).toEqual({
      ok: true,
      assignment: {
        supply: "E-005",
        brain: "C-001",
        brain_input: "primary",
        window: [4.845, 5.355],
        peripherals: [{ capability: "read.motion_bool", part: "L-003", rail: "E-005", window: [5, 5.355] }],
      },
    });
  });

  it("plant waterer: the servo runs from the USB supply, the probe from C-001's rail", () => {
    const result = checkPowerPath(build("plant-waterer"), live);
    expect(result).toMatchObject({
      ok: true,
      assignment: {
        supply: "E-005",
        brain_input: "primary",
        peripherals: [
          { capability: "read.soil_moisture_pct", part: "P-005", rail: "C-001 rail", window: [3.3, 3.349] },
          { capability: "act.position_deg", part: "M-001", rail: "E-005", window: [4.845, 5.355] },
        ],
      },
    });
  });

  it("refuses the cell straight onto C-001's 3V3 pin", () => {
    const direct = { ...build("fridge-monitor"), power: { supply: "power.battery", brain_input: "3v3-pin" } };
    expect(checkPowerPath(direct, live)).toEqual({ ok: false, problems: ["E-001 (2.5–4.2 V) can't feed C-001 3v3-pin (3–3.6 V)"] });
  });

  it("can't find a safe window for the 5 V-only HC-SR04 on the 5.1 V ± 5 % supply", () => {
    const ranging = { ...build("presence-alert"), requires: ["read.distance_cm"] };
    expect(checkPowerPath(ranging, live)).toEqual({ ok: false, problems: ["no part providing read.distance_cm runs from E-005 or C-001's rail"] });
  });
});
