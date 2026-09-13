import { expect, it } from "vitest";
import { fixture } from "./fixtures";
import { solve } from "./solver";

/** An independent tiny oracle: two alternative sensors, a fixed USB host and
 * one port per interface. Exhaust all sensor subsets without calling matcher
 * checks, wiring, power or rank helpers. Sweep missing evidence, conflicts,
 * current limits and prices with a repeatable generator. */
it("agrees with exhaustive feasibility and minimum-cost enumeration in 120 generated catalogues", () => {
  let seed = 9281;
  const random = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  const template = fixture();
  for (let trial = 0; trial < 120; trial++) {
    const input = structuredClone(template);
    input.parts = input.parts.filter(p => ["C-001", "E-005", "P-001", "P-002"].includes(p.id));
    input.profiles = input.profiles.filter(p => p.source.id === "E-005");
    const profile = input.profiles[0]!;
    const brain = input.parts.find(p => p.id === "C-001")!;
    const source = input.parts.find(p => p.id === "E-005")!;
    const sensors = input.parts.filter(p => p.id.startsWith("P-"));
    const sourceLimit = 110 + random(8);
    source.electrical.supply!.max_output_ma = sourceLimit;
    const enabled = [random(3) !== 0, random(3) !== 0];
    sensors.forEach((p, i) => {
      p.commerce.unit_cost_usd = 1 + random(20);
      p.electrical.current_draw_ma = { idle: 0, active: random(15) };
      if (!enabled[i]) input.compat = input.compat.filter(c => c.driver_pkg !== p.software.driver_pkg);
    });
    const conflict = random(2) === 0;
    if (conflict) sensors[0]!.electrical.conflicts = [sensors[1]!.id];
    let expectedCost = Infinity;
    for (let mask = 1; mask < 4; mask++) {
      if (conflict && mask === 3) continue;
      if (sensors.some((_, i) => (mask & (1 << i)) !== 0 && !enabled[i])) continue;
      const chosen = sensors.filter((_, i) => (mask & (1 << i)) !== 0);
      const peakRail = 100 + chosen.reduce((sum, p) => sum + p.electrical.current_draw_ma.active, 0);
      const peakSource = peakRail * 3.3 / (4.845 * 0.6) + 0.1;
      if (peakSource > sourceLimit) continue;
      const cost = brain.commerce.unit_cost_usd! + source.commerce.unit_cost_usd! + chosen.reduce((sum, p) => sum + p.commerce.unit_cost_usd!, 0);
      expectedCost = Math.min(cost, expectedCost);
    }
    const result = solve(input);
    if (expectedCost === Infinity) { expect(result.status, `trial ${trial}`).toBe("infeasible"); continue; }
    expect(result.status, `trial ${trial}`).toBe("solved");
    if (result.status !== "solved") throw new Error(JSON.stringify(result));
    expect(result.plans[0]!.total_cost_usd).toBeCloseTo(expectedCost, 10);
    for (const plan of result.plans) {
      const ids = plan.part_versions.map(p => p.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(plan.power_budget.peak_source_ma).toBeLessThanOrEqual(sourceLimit);
      expect(plan.power_budget.peak_brain_rail_ma).toBeLessThanOrEqual(brain.electrical.supply!.max_output_ma);
      for (const edge of plan.wiring_graph.peripherals) {
        expect(profile.ports.find(port => port.id === edge.port)?.connector).toBe(edge.connector);
        expect(enabled[sensors.findIndex(p => p.id === edge.part.id)]).toBe(true);
      }
      if (conflict) expect(ids.includes("P-001") && ids.includes("P-002")).toBe(false);
    }
  }
// The repository runs all packages concurrently on a shared CI runner. This
// is a correctness sweep, not a five-second performance benchmark.
}, 30_000);
