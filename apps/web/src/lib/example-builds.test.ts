import { ListingList, PartDefinition, Showcase } from "@albusforge/schema";
import { describe, expect, it } from "vitest";
import { GOLDEN_BUILDS } from "../../../../registry/scripts/golden-builds";
import { loadParts } from "../../../../registry/scripts/lib/load";
import { usableWindow } from "../../../../registry/scripts/lib/power";
import { EXAMPLE_BUILDS, EXAMPLE_PARTS, exampleBuildDetail, exampleListing, exampleListings, exampleShowcase } from "./example-builds";

const registry = new Map(loadParts().map((part) => [part.id, part]));

const partOf = (id: string): PartDefinition => {
  const found = EXAMPLE_PARTS.get(id);
  if (!found) throw new Error(`${id} not bundled`);
  return found;
};

describe("example builds use the registry's parts", () => {
  it("every bundled part is identical to the registry's part.json", () => {
    for (const [id, part] of EXAMPLE_PARTS) {
      expect(registry.get(id), id).toEqual(part);
    }
  });

  it("every part a build pins is bundled", () => {
    for (const build of EXAMPLE_BUILDS) {
      for (const { id } of build.parts) expect(EXAMPLE_PARTS.has(id), `${build.id} uses ${id}`).toBe(true);
    }
  });

  it("build ids are unique", () => {
    expect(new Set(EXAMPLE_BUILDS.map((b) => b.id)).size).toBe(EXAMPLE_BUILDS.length);
  });
});

describe.each(EXAMPLE_BUILDS.map((build) => [build.id, build] as const))("%s passes the registry's checks", (_id, build) => {
  const parts = build.parts.map(({ id, qty }) => ({ part: partOf(id), qty }));
  const brains = parts.filter(({ part }) => part.electrical.interface === "host");

  it("has exactly one brain", () => {
    expect(brains).toHaveLength(1);
    expect(brains[0]!.qty).toBe(1);
  });

  it("meets every part's requirements from parts in the build", () => {
    const provided = new Set(parts.flatMap(({ part }) => part.software.capabilities));
    for (const { part } of parts) {
      for (const need of part.electrical.requires) expect(provided.has(need), `${part.id} requires ${need}`).toBe(true);
    }
  });

  it("has no two I2C devices on the same address", () => {
    const addresses = parts.flatMap(({ part, qty }) => (part.electrical.i2c_address ? Array(qty).fill(part.electrical.i2c_address) : []));
    expect(new Set(addresses).size).toBe(addresses.length);
  });

  it("has a voltage-compatible power path (registry/scripts/lib/power.ts)", () => {
    const brain = brains[0]!.part;
    const supply = partOf(build.power.supply);
    expect(build.parts.some((p) => p.id === supply.id), "supply is in the build").toBe(true);
    const output = supply.electrical.supply?.output_v;
    expect(output, `${supply.id} supplies power`).toBeDefined();

    const input =
      build.power.brainInput === "primary"
        ? brain.electrical.voltage_range
        : brain.electrical.alt_inputs?.find((i) => i.name === build.power.brainInput)?.voltage_range;
    expect(input, `${brain.id} has input ${build.power.brainInput}`).toBeDefined();
    expect(usableWindow(output!, input!), `${supply.id} feeds ${brain.id} ${build.power.brainInput}`).not.toBeNull();

    const brainRail = brain.electrical.supply?.output_v;
    for (const { part } of parts) {
      if (part.electrical.interface === "host" || part.electrical.interface === "power") continue;
      const fromSupply = part.electrical.requires.includes("power.5v");
      const rail = fromSupply ? output : brainRail;
      if (fromSupply) expect(supply.software.capabilities, `${part.id} needs power.5v from ${supply.id}`).toContain("power.5v");
      expect(usableWindow(rail!, part.electrical.voltage_range), `${part.id} runs from ${fromSupply ? supply.id : "the brain rail"}`).not.toBeNull();
    }
  });
});

describe("the golden builds are among the examples", () => {
  it.each(GOLDEN_BUILDS.map((golden) => [golden.id, golden] as const))("%s: an example with that id provides every required capability", (id, golden) => {
    const build = EXAMPLE_BUILDS.find((b) => b.id === id);
    expect(build, id).toBeDefined();
    const provided = new Set(build!.parts.flatMap(({ id: partId }) => partOf(partId).software.capabilities));
    for (const cap of golden.requires) expect(provided.has(cap), `${id} provides ${cap}`).toBe(true);
    expect(partOf(build!.power.supply).software.capabilities).toContain(golden.power.supply);
    expect(build!.power.brainInput).toBe(golden.power.brain_input);
  });
});

describe("example data", () => {
  it("the showcase matches the API schema, and each card links to a listing", () => {
    const now = new Date("2026-09-13T12:00:00Z");
    const cards = exampleShowcase(now);
    expect(Showcase.parse({ cards }).cards).toHaveLength(6);
    for (const card of cards) {
      expect(exampleListing(card.id), card.id).not.toBeNull();
      expect(new Date(card.last_reading_at).getTime()).toBeLessThan(now.getTime());
    }
  });

  it("listings match the API schema, cover every category, and state a parts cost from the registry", () => {
    const { listings, next_cursor } = ListingList.parse(exampleListings(null));
    expect(listings).toHaveLength(EXAMPLE_BUILDS.length);
    expect(next_cursor).toBeNull();
    expect(new Set(listings.map((l) => l.category))).toEqual(new Set(["garden", "home", "workshop", "industrial"]));
    // ESP32-S3 19.95 + DS18B20 9.95 + USB-C supply 8.74, all priced.
    expect(exampleListing("cold-room-temperature-log")!.description).toMatch(/About \$39 in parts\.$/);
    // The TP4056 has no price yet, so the cost is a lower bound.
    expect(exampleListing("fridge-monitor")!.description).toMatch(/From \$\d+ in parts\.$/);
  });

  it("filters by category before paging", () => {
    const home = exampleListings("home", null, 2);
    expect(home.listings.map((l) => l.category)).toEqual(["home", "home"]);
    expect(home.next_cursor).toBe("2");
    const rest = exampleListings("home", home.next_cursor, 2);
    expect(rest.listings.every((l) => l.category === "home")).toBe(true);
    expect(rest.next_cursor).toBeNull();
  });

  it("a detail lists each part line with its registry price, and the total counts unpriced lines", () => {
    const detail = exampleBuildDetail("greenhouse-soil-monitor")!;
    const probes = detail.lines.find((line) => line.part.id === "P-005")!;
    expect(probes).toMatchObject({ qty: 4, lineCostUsd: 23.6 });
    expect(detail.unpricedLines).toBe(1); // TP4056
    expect(detail.partsCostUsd).toBeCloseTo(19.95 + 23.6 + 9.95, 2);
    expect(detail.supply.id).toBe("E-001");
    expect(exampleBuildDetail("nope")).toBeNull();
  });

  it("a USB-C supply into the brain's Micro-USB port says an adapter is needed; a cell on the 5V pin doesn't", () => {
    for (const build of EXAMPLE_BUILDS) {
      const { notes } = exampleBuildDetail(build.id)!;
      const adapter = notes.some((note) => /usb-c-v1.*usb-micro-b-v1.*adapter cable/.test(note));
      expect(adapter, build.id).toBe(build.power.supply === "E-005");
    }
  });
});
