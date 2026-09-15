import { describe, expect, it } from "vitest";
import { profileForChannels, provisionedWiring } from "./provisioned-wiring";

/*
 * The setup page draws a provisioned device's real wiring. What matters most is
 * the pins: this board's camera sits on the pins a default map would pick.
 */
const CHANNELS = ["illuminance", "temperature", "humidity"];

describe("provisionedWiring", () => {
  it("uses the assembly profile's pins, never the marketplace default", () => {
    const wiring = provisionedWiring(CHANNELS)!;
    expect(wiring).not.toBeNull();
    const busPins = wiring.nodes
      .flatMap((node) => node.units.flatMap((unit) => unit.leads))
      .filter((lead) => lead.pin.role === "sda" || lead.pin.role === "scl")
      .map((lead) => lead.source.label);
    // GPIO8/GPIO9 are the camera's data pins on this board: drawing them would
    // tell someone to wire a sensor onto the camera.
    expect(busPins).not.toContain("GPIO8");
    expect(busPins).not.toContain("GPIO9");
    expect(busPins.filter((pin) => pin.startsWith("GPIO"))).toEqual(expect.arrayContaining(["GPIO47", "GPIO21"]));
  });

  it("wires to the Freenove board and its USB supply", () => {
    const wiring = provisionedWiring(CHANNELS)!;
    expect(wiring.brain.id).toBe("C-002");
    expect(wiring.supply.part.id).toBe("E-005");
    expect(wiring.supply.brainInput).toBe("primary");
    // Every peripheral sees the board's regulated rail.
    for (const node of wiring.nodes) expect(node.rail.window).toEqual(wiring.brain.electrical.supply!.output_v);
  });

  it("chains a sensor into one with a spare socket, as the marketplace does", () => {
    const wiring = provisionedWiring(CHANNELS)!;
    const chained = wiring.nodes.filter((node) => node.chainedTo !== null);
    for (const node of chained) {
      expect(wiring.nodes.some((other) => other.part.id === node.chainedTo)).toBe(true);
      // Every conductor of a chained part goes down the one cable.
      expect(new Set(node.units[0]!.leads.map((lead) => lead.source.kind))).toEqual(new Set(["chain"]));
    }
  });

  it("draws nothing when the channels match no profile", () => {
    expect(profileForChannels(["not_a_channel"])).toBeNull();
    expect(provisionedWiring(["not_a_channel"])).toBeNull();
    expect(provisionedWiring([])).toBeNull();
  });

  it("matches a profile that covers the device's channels, even a subset of them", () => {
    expect(profileForChannels(["illuminance"])?.id).toBe("freenove-light-climate");
    // A channel the profile doesn't have means it isn't this build.
    expect(profileForChannels([...CHANNELS, "soil_moisture"])).toBeNull();
  });
});
