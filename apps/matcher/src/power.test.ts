import { describe, expect, it } from "vitest";
import { averageCurrent, containsVoltage, powerBudget } from "./power";
import { fixture } from "./fixtures";

describe("power dimensions and assumptions", () => {
  it("uses hours / 24, measured capacity reserve, and conversion losses", () => {
    const input = fixture();
    const brain = input.parts.find(p => p.id === "C-001")!;
    const source = input.parts.find(p => p.id === "E-001")!;
    brain.electrical.current_draw_ma = { idle: 10, active: 10 };
    brain.electrical.supply!.output_v = [3, 3];
    source.electrical.supply!.output_v = [4, 4];
    source.electrical.supply!.capacity_mah = 2400;
    const profile = input.profiles.find(p => p.source.id === source.id)!;
    profile.regulator_efficiency = 0.75; profile.quiescent_source_ma = 0;
    const budget = powerBudget(brain, source, [], [], profile, input.spec);
    expect(budget.average_source_ma).toBe(10);
    expect(budget.usable_capacity_mah).toBe(1200);
    expect(budget.estimated_life_days).toBe(5);
  });
  it("requires activity evidence to use idle current, and clamps duty at 1", () => {
    const input = fixture();
    const brain = input.parts.find(p => p.id === "C-001")!;
    const profile = input.profiles[0]!;
    expect(averageCurrent(brain, 100, profile)).toBeCloseTo(1.99);
    expect(averageCurrent(brain, 0.5, profile)).toBe(100);
    profile.activity = [];
    expect(averageCurrent(brain, 100, profile)).toBe(100);
  });
  it("requires full voltage containment", () => {
    expect(containsVoltage([3, 5], [3.3, 3.4])).toBe(true);
    expect(containsVoltage([3.3, 5], [3.251, 3.349])).toBe(false);
    expect(containsVoltage([3, 3.3], [3.3, 3.4])).toBe(false);
  });
});
