import { ConnectorDefinition, usableWindow } from "@albusforge/schema";
import { describe, expect, it } from "vitest";
import { loadRegistry } from "../../../../registry/scripts/lib/load";
import { EXAMPLE_BUILDS, EXAMPLE_PARTS } from "./example-builds";
import { BRAIN_HEADER, CONNECTORS, exampleWiring, volts } from "./example-wiring";

const registry = new Map(
  loadRegistry().connectors.map((file) => {
    const connector = ConnectorDefinition.parse(file.data);
    return [connector.id, connector];
  }),
);

const HEADER_PINS = new Set<string>([
  BRAIN_HEADER.rail3v3,
  BRAIN_HEADER.rail5v,
  BRAIN_HEADER.ground,
  BRAIN_HEADER.sda,
  BRAIN_HEADER.scl,
  ...BRAIN_HEADER.adc,
  ...BRAIN_HEADER.digital,
  ...BRAIN_HEADER.pwm,
]);

describe("the wiring uses the registry's connectors", () => {
  it("every bundled connector is identical to the registry's json", () => {
    for (const [id, connector] of CONNECTORS) expect(registry.get(id), id).toEqual(connector);
  });

  it("every connector an example build's parts use is bundled", () => {
    for (const part of EXAMPLE_PARTS.values()) expect(CONNECTORS.has(part.electrical.connector), `${part.id} ${part.electrical.connector}`).toBe(true);
  });
});

describe.each(EXAMPLE_BUILDS.map((build) => [build.id, build] as const))("%s wiring", (_id, build) => {
  const wiring = exampleWiring(build);
  const leads = wiring.nodes.flatMap((node) => node.units.flatMap((unit) => unit.leads.map((lead) => ({ node, unit, lead }))));

  it("wires one block per unit of every peripheral the build pins", () => {
    const peripherals = build.parts.filter(({ id }) => {
      const part = EXAMPLE_PARTS.get(id)!;
      return part.electrical.interface !== "host" && part.electrical.interface !== "power";
    });
    expect(wiring.nodes.map((node) => node.part.id)).toEqual(peripherals.map(({ id }) => id));
    for (const node of wiring.nodes) {
      expect(node.units).toHaveLength(peripherals.find(({ id }) => id === node.part.id)!.qty);
      // Every pin of the part's connector is wired, none invented.
      for (const unit of node.units) expect(unit.leads.map(({ pin }) => pin.n)).toEqual(node.connector.pins.map((pin) => pin.n));
    }
  });

  it("lands every lead on a header pin the board has, on the supply, or on a part already on the bus", () => {
    const units = wiring.nodes.flatMap((node) => node.units.map((unit) => unit.label));
    for (const { unit, lead } of leads) {
      if (lead.source.kind === "header") expect(HEADER_PINS.has(lead.source.label), `${lead.pin.name} → ${lead.source.label}`).toBe(true);
      else if (lead.source.kind === "chain") {
        // A chained lead plugs into a unit that is itself already wired, and earlier in the chain.
        expect(units, `${unit.label} chains into ${lead.source.label}`).toContain(lead.source.label);
        expect(units.indexOf(lead.source.label)).toBeLessThan(units.indexOf(unit.label));
      } else expect(lead.source.label).toMatch(new RegExp(`^${build.power.supply} `));
    }
  });

  it("daisy-chains the I2C parts so exactly one cable reaches the board", () => {
    const busUnits = wiring.nodes.filter((node) => node.part.electrical.interface === "i2c").flatMap((node) => node.units);
    if (busUnits.length === 0) return;
    // Every unit either reaches the header or plugs into the one before it: one path, one end.
    const onHeader = busUnits.filter((unit) => unit.leads.every((lead) => lead.source.kind === "header"));
    expect(onHeader).toHaveLength(1);
    for (const unit of busUnits) {
      if (unit === onHeader[0]) continue;
      // A chained unit goes down one cable: every conductor to the same place.
      expect(new Set(unit.leads.map((lead) => `${lead.source.kind}:${lead.source.label}`)).size).toBe(1);
      expect(unit.leads[0]!.source.kind).toBe("chain");
    }
    // The one that reaches the board uses the board's I2C pins.
    for (const lead of onHeader[0]!.leads) {
      if (lead.pin.role === "sda") expect(lead.source.label).toBe(BRAIN_HEADER.sda);
      if (lead.pin.role === "scl") expect(lead.source.label).toBe(BRAIN_HEADER.scl);
    }
  });

  it("gives each signal its own pin", () => {
    const signals = leads.filter(({ lead }) => lead.pin.role === "signal");
    expect(new Set(signals.map(({ lead }) => lead.source.label)).size).toBe(signals.length);
  });

  it("carries the volts the registry's power check works out, on the power lead only", () => {
    for (const node of wiring.nodes) {
      expect(node.usable, `${node.part.id} from ${node.rail.label}`).toEqual(usableWindow(node.rail.window, node.part.electrical.voltage_range));
      // power.ts: a part that asks for power.5v runs from the supply, everything else from the brain's rail.
      const fromSupply = node.part.electrical.requires.includes("power.5v");
      expect(node.rail.window).toEqual(fromSupply ? wiring.supply.part.electrical.supply!.output_v : wiring.rail);
      for (const { leads: unitLeads } of node.units) {
        const power = unitLeads.filter((lead) => lead.window !== null);
        expect(power.map((lead) => lead.pin.role)).toEqual(["power"]);
        expect(power[0]!.window).toEqual(node.usable);
        // A supply-fed part hangs off the supply, never off the board's 5V header: that pin is an
        // input, and sits after the USB Schottky, so it carries less than the supply puts out.
        // A chained part takes power and ground down the same cable as the bus; the
        // rail behind it is still the board's, which is why `usable` is unchanged.
        const chained = power[0]!.source.kind === "chain";
        if (!chained) {
          expect(power[0]!.source).toEqual(
            fromSupply
              ? { kind: "supply", label: `${wiring.supply.part.id} ${wiring.supply.connector.pins.find((pin) => pin.role === "power")!.name}` }
              : { kind: "header", label: BRAIN_HEADER.rail3v3 },
          );
          // Ground is common whatever powers the part.
          expect(unitLeads.find((lead) => lead.pin.role === "ground")!.source).toEqual({ kind: "header", label: BRAIN_HEADER.ground });
        }
      }
    }
  });

  it("names the I2C address on the bus leads", () => {
    for (const { node, lead } of leads) {
      if (lead.pin.role === "sda" || lead.pin.role === "scl") expect(lead.signal).toBe(`I²C ${node.part.electrical.i2c_address}`);
    }
  });

  it("feeds the brain from the build's supply, over a window the board stays up on", () => {
    expect(wiring.supply.part.id).toBe(build.power.supply);
    expect(wiring.supply.brainInput).toBe(build.power.brainInput);
    expect(wiring.supply.window).not.toBeNull();
    // Anything else that supplies power — a charger — hangs off the supply, not the brain.
    expect(wiring.supply.upstream.map(({ part }) => part.id)).toEqual(
      build.parts.map(({ id }) => EXAMPLE_PARTS.get(id)!).filter((part) => part.electrical.interface === "power" && part.id !== build.power.supply).map((part) => part.id),
    );
  });
});

describe("wiring notes", () => {
  it("One-Wire says the pull-up isn't in the parts list; I2C needs no note", () => {
    const oneWire = exampleWiring(EXAMPLE_BUILDS.find((build) => build.id === "cold-room-temperature-log")!);
    expect(oneWire.nodes[0]!.notes.join(" ")).toContain("4.7 kΩ pull-up");
    const i2cOnly = exampleWiring(EXAMPLE_BUILDS.find((build) => build.id === "orchid-light-humidity")!);
    expect(i2cOnly.nodes.flatMap((node) => node.notes)).toEqual([]);
  });

  it("spells a window the way the registry does", () => {
    expect(volts([3.251, 3.349])).toBe("3.251–3.349 V");
  });
});
