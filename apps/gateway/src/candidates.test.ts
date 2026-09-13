import { readValidatedParts } from "@albusforge/registry/db-load";
import { REGISTRY_ROOT } from "@albusforge/registry/load";
import { CandidatePart } from "@albusforge/schema";
import { describe, expect, it } from "vitest";
import { matchCandidates, specCapabilities } from "./candidates";

const registry = readValidatedParts(REGISTRY_ROOT);

describe("matchCandidates", () => {
  it("returns parts whose capabilities intersect the spec's, sorted by id, with what matched", () => {
    const shuffled = [...registry].reverse();
    const found = matchCandidates(shuffled, ["read.temperature_c", "read.humidity_pct", "power.battery", "read.unknown_x"]);
    expect(found.map((p) => [p.id, p.matched_capabilities])).toEqual([
      ["E-001", ["power.battery"]],
      ["P-001", ["read.humidity_pct", "read.temperature_c"]],
      ["P-002", ["read.temperature_c"]],
    ]);
    for (const part of found) CandidatePart.parse(part);
  });

  it("matches nothing for no capabilities", () => {
    expect(matchCandidates(registry, [])).toEqual([]);
  });
});

describe("specCapabilities", () => {
  it("reads capabilities and passes everything else through", () => {
    expect(specCapabilities({ capabilities: ["read.temperature_c"], settled: false, sense: { x: 1 } })).toEqual(["read.temperature_c"]);
  });

  it.each([null, [], "text", { capabilities: "read.temperature_c" }, { settled: true }])("reads none from %j", (data) => {
    expect(specCapabilities(data)).toEqual([]);
  });
});
