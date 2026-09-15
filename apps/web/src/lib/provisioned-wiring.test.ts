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

  it("takes the profile whose channels match exactly, not merely one that covers them", () => {
    // illuminance alone is covered by freenove-light AND freenove-light-climate.
    // Taking the first would draw a BME280 that is not on the bench.
    expect(profileForChannels(["illuminance"])?.id).toBe("freenove-light");
    expect(profileForChannels(["soil_moisture"])?.id).toBe("freenove-soil");
    expect(profileForChannels(CHANNELS.concat("pressure"))?.id).toBe("freenove-light-climate");
    // A channel no profile has means it is not one of these builds.
    expect(profileForChannels([...CHANNELS, "soil_moisture"])).toBeNull();
  });

  it("draws nothing rather than guess when more than one profile could be the build", () => {
    // A subset of the climate profile's channels, covered by it alone here, is
    // fine; the dangerous case is a subset covered by two, which must refuse.
    const ambiguous = profileForChannels(["illuminance"]);
    expect(ambiguous?.part_versions.map((part) => part.id)).not.toContain("P-001");
    // Partial reporting during bring-up: temperature+humidity is covered only by
    // the climate profile, so it still resolves.
    expect(profileForChannels(["temperature", "humidity"])?.id).toBe("freenove-light-climate");
  });

  it("refuses a brain whose rail pin names are not recorded", () => {
    // Rail and ground labels are read off a board, not carried by the assembly
    // schema, so an unknown brain must draw nothing rather than assume "3V3".
    const wiring = provisionedWiring(CHANNELS)!;
    expect(wiring.brain.id).toBe("C-002");
    const railLeads = wiring.nodes.flatMap((node) => node.units[0]!.leads).filter((lead) => lead.pin.role === "power");
    for (const lead of railLeads) expect(["3V3", "chain"]).toContain(lead.source.kind === "chain" ? "chain" : lead.source.label);
  });
});
