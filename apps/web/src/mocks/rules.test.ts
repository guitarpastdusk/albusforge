import type { Channel } from "@albusforge/schema";
import { describe, expect, it } from "vitest";
import { readRule } from "./rules";

const channels: Channel[] = [
  { key: "soil_vwc", label: "Soil moisture", unit: "% VWC", kind: "number", precision: 1, valid_range: [0, 60] },
  { key: "battery", label: "Battery", unit: "%", kind: "number", precision: 0, valid_range: [0, 100] },
];

describe("readRule (mock proposal reader)", () => {
  it("reads action-first words into a SERVO rule with no issues", () => {
    const reading = readRule("water for 5 min when soil drops below 22%", channels);
    expect(reading).toMatchObject({ kind: "SERVO", rule: "Soil moisture < 22% → water for 5 min", issues: [] });
    expect(reading.summary).toMatch(/^When soil moisture is below 22 % VWC, water for 5 min\./);
  });

  it("reads condition-first words, and a notification as ALERT", () => {
    const reading = readRule("If battery falls below 15%, text me", channels);
    expect(reading).toMatchObject({ kind: "ALERT", rule: "Battery < 15% → text me", issues: [] });
    expect(reading.summary).toContain("A person is notified");
  });

  it("flags a channel this device doesn't measure, and doesn't guess one", () => {
    const reading = readRule("start the fan when temperature goes above 30", channels);
    expect(reading.kind).toBe("API");
    expect(reading.issues).toEqual([expect.stringMatching(/doesn't measure temperature\. It has: soil moisture, battery\./)]);
  });

  it("flags a missing threshold and a missing action separately", () => {
    expect(readRule("when the soil is dry", channels).issues).toEqual([
      expect.stringMatching(/couldn't find a threshold/),
      expect.stringMatching(/Say what should happen/),
    ]);
  });

  it("reads symbolic comparators, spaced or not", () => {
    expect(readRule("text me when soil < 22%", channels)).toMatchObject({ kind: "ALERT", rule: "Soil moisture < 22% → text me", issues: [] });
    expect(readRule("text me when battery>90", channels)).toMatchObject({ rule: "Battery > 90% → text me", issues: [] });
  });

  it("flags a threshold outside the channel's valid range", () => {
    expect(readRule("text me when soil drops below 80%", channels).issues).toEqual([expect.stringMatching(/80 is outside soil moisture's range of 0–60/)]);
  });
});
