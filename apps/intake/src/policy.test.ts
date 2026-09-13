import { describe, expect, it } from "vitest";
import { screen } from "./policy";

const category = (text: string) => {
  const decision = screen(text);
  return decision.outcome === "OUT_OF_SCOPE" ? decision.category : "ALLOW";
};

describe("scope filter", () => {
  it.each([
    ["build me a remote trigger for a gun", "weapons_harm"],
    ["a sensor that sets off an explosive", "weapons_harm"],
    ["DIY taser with motion detection", "weapons_harm"],
    ["shock intruders when they open the gate", "weapons_harm"],
    ["something to zap the neighbour's cat", "weapons_harm"],
    ["switch a 230V heater on a schedule", "mains_voltage"],
    ["wire it into the mains", "mains_voltage"],
    ["control my 120 volt lamp", "mains_voltage"],
    ["replace the light switch in my hallway", "mains_voltage"],
    ["monitor my dad's heart rate at night", "medical_monitoring"],
    ["alert me if blood glucose drops", "medical_monitoring"],
    ["a pulse oximeter for my grandma", "medical_monitoring"],
    ["diagnose sleep apnea", "medical_monitoring"],
    ["I want to spy on my roommate", "covert_tracking"],
    ["track my girlfriend's location without her knowing", "covert_tracking"],
    ["hide a gps tracker in my husband's car", "covert_tracking"],
    ["secretly record my employees", "covert_tracking"],
    // Normalization: case, fullwidth characters and odd spacing don't dodge a rule.
    ["ＭＡＩＮＳ   powered relay", "mains_voltage"],
  ])("refuses %j as %s", (text, expected) => {
    expect(category(text)).toBe(expected);
  });

  it.each([
    "keep my greenhouse soil moist",
    "tell me when the fridge gets too warm",
    "alert me when someone is at the front door",
    "a glue gun temperature monitor",
    "water my plants when the soil is dry",
    "track the temperature in my garage",
    "a hidden sensor under the sink that detects leaks",
    "is my kid's bedroom too cold at night",
    "plug it into a USB wall charger",
    "measure how far the water level is from the lid",
    "a bath bomb shop display that counts visitors",
    "kill the lights when nobody is home",
    "run it on a battery for 90 days",
  ])("allows %j", (text) => {
    expect(category(text)).toBe("ALLOW");
  });

  it("returns the OUT_OF_SCOPE code with the category", () => {
    expect(screen("a mains timer")).toEqual({ outcome: "OUT_OF_SCOPE", code: "OUT_OF_SCOPE", category: "mains_voltage" });
  });
});
