import { describe, expect, it } from "vitest";
import { solve } from "./solver";
import { fixture, goldenSpecs, registryParts } from "./fixtures";
import type { SolveInput } from "./types";

function best(input: SolveInput) {
  const result = solve(input);
  expect(result.status, JSON.stringify(result)).toBe("solved");
  if (result.status !== "solved") throw new Error(JSON.stringify(result));
  return result.plans[0]!;
}
function infeasible(input: SolveInput) {
  const result = solve(input);
  expect(result.status, JSON.stringify(result)).toBe("infeasible");
  if (result.status !== "infeasible") throw new Error(JSON.stringify(result));
  return result;
}

describe("golden specs", () => {
  const expected = {
    "fridge-monitor": ["C-001", "E-001", "P-001"],
    "presence-alert": ["C-001", "E-005", "L-003"],
    "plant-waterer": ["C-001", "E-005", "M-001", "P-005"],
  };
  for (const [name, spec] of Object.entries(goldenSpecs)) {
    it(`solves synthetic ${name} with pinned BOM, wiring and budgets`, () => {
      const input = fixture(spec.capabilities);
      Object.assign(input.spec, spec);
      const plan = best(input);
      expect(plan.part_versions.map(p => p.id)).toEqual(expected[name as keyof typeof expected]);
      expect(plan.bom.map(b => b.part)).toEqual(plan.part_versions);
      expect(plan.wiring_graph.peripherals).toHaveLength(plan.part_versions.length - 2);
      expect(plan.power_budget.peak_source_ma).toBeGreaterThan(plan.power_budget.average_source_ma);
      if (name === "fridge-monitor") expect(plan.power_budget.estimated_life_days).toBeGreaterThanOrEqual(7);
    });
    it(`refuses the current draft catalogue for ${name}`, () => {
      const input = fixture(spec.capabilities);
      Object.assign(input.spec, spec);
      input.parts = registryParts();
      expect(infeasible(input).conflict_set).toEqual([]);
    });
  }
});

describe("constraint failures", () => {
  it("reports a missing capability as an inclusion-minimal conflict", () => {
    const input = fixture(["read.temperature_c", "read.unobtainium_pct"]);
    expect(infeasible(input).conflict_set).toEqual(["capability:read.unobtainium_pct"]);
    input.spec.capabilities = ["read.temperature_c"];
    best(input);
  });
  it("reports a conflicting pair, each feasible alone", () => {
    const input = fixture(["read.temperature_c", "read.motion_bool"]);
    input.parts.find(p => p.id === "L-003")!.electrical.conflicts = ["P-001", "P-002"];
    expect(infeasible(input).conflict_set).toEqual(["capability:read.motion_bool", "capability:read.temperature_c"]);
    for (const c of input.spec.capabilities) best({ ...input, spec: { ...input.spec, capabilities: [c] } });
  });
  it("checks dependencies of selected parts", () => {
    const input = fixture(["read.humidity_pct"]);
    input.parts.find(p => p.id === "P-001")!.electrical.requires.push("bus.unavailable");
    expect(infeasible(input).diagnostics.some(d => d.constraint === "requires")).toBe(true);
  });
  it.each(["failed", "pending", "missing", "wrong-version", "wrong-runtime", "wrong-brain"])("requires exact passed compile evidence: %s", status => {
    const input = fixture(["read.humidity_pct"]);
    const row = input.compat.find(c => c.driver_pkg === "hsx-driver-bme280")!;
    if (status === "missing") input.compat = [];
    else if (status === "wrong-version") row.driver_ver = "0.2.0";
    else if (status === "wrong-runtime") row.runtime_ver = "0.2.0";
    else if (status === "wrong-brain") row.brain_id = "C-002";
    else row.status = status as "failed" | "pending";
    expect(infeasible(input).diagnostics.some(d => d.constraint === "compatibility")).toBe(true);
  });
  it("does not use a draft, deprecated or retired provider even with green compiles", () => {
    for (const status of ["draft", "deprecated", "retired"] as const) {
      const input = fixture(["read.humidity_pct"]);
      const part = input.parts.find(p => p.id === "P-001")!;
      part.status = status;
      if (status === "deprecated") part.successor = "P-002";
      infeasible(input);
    }
  });
  it("rejects incompatible runtime ranges", () => {
    const input = fixture(["read.humidity_pct"]);
    input.parts.find(p => p.id === "P-001")!.software.min_runtime = "^1.0.0";
    expect(infeasible(input).diagnostics.some(d => d.constraint === "runtime")).toBe(true);
  });
  it("refuses 5V logic on a 3.3V host", () => {
    const input = fixture(["read.motion_bool"]);
    input.parts.find(p => p.id === "L-003")!.electrical.logic_v = [5, 5];
    expect(infeasible(input).diagnostics.some(d => d.constraint === "logic")).toBe(true);
  });
  it("never treats overlapping voltage ranges as a complete operating guarantee", () => {
    const input = fixture(["read.soil_moisture_pct"]);
    input.parts.find(p => p.id === "P-005")!.electrical.voltage_range = [3.3, 5.5];
    input.parts.find(p => p.id === "C-001")!.electrical.supply!.output_v = [3.251, 3.349];
    infeasible(input);
  });
  it("rejects wrong or missing port connectors instead of inventing adapters", () => {
    const input = fixture(["read.humidity_pct"]);
    for (const p of input.profiles) p.ports.find(p => p.id === "i2c")!.connector = "hsx-3pin-v1";
    infeasible(input);
  });
  it("checks connector voltage ratings", () => {
    const input = fixture(["read.humidity_pct"]);
    input.connectors.find(c => c.id === "hsx-i2c-4pin-v1")!.max_voltage = 3.0;
    infeasible(input);
  });
  it("does not double-allocate a GPIO through two named ports", () => {
    const input = fixture(["read.soil_moisture_pct", "act.position_deg"]);
    for (const p of input.profiles) p.ports.find(p => p.id === "servo")!.resources = ["io3"];
    infeasible(input);
  });
  it("enforces peak source and host current independently of duty", () => {
    const input = fixture(["read.humidity_pct"]);
    const source = input.parts.find(p => p.id === "E-005")!;
    source.electrical.supply!.max_output_ma = 10;
    expect(infeasible(input).diagnostics.some(d => d.constraint === "current")).toBe(true);
    source.electrical.supply!.max_output_ma = 3000;
    input.parts.find(p => p.id === "C-001")!.electrical.supply!.max_output_ma = 100;
    infeasible(input);
  });
  it("checks per-port current capacity", () => {
    const input = fixture(["act.position_deg"]);
    for (const profile of input.profiles) profile.ports.find(p => p.id === "servo")!.max_current_ma = 500;
    infeasible(input);
  });
  it("selects a source from the requested power domain", () => {
    const input = fixture();
    input.spec.power_source = "solar";
    expect(infeasible(input).conflict_set).toEqual([]);
  });
  it("reports a battery target without hiding a feasible lower-power request", () => {
    const input = fixture();
    input.spec.power_source = "battery";
    input.spec.target_life_days = 1_000_000;
    expect(infeasible(input).conflict_set).toEqual(["target_life_days"]);
    delete input.spec.target_life_days;
    best(input);
  });
  it("checks I2C address uniqueness on shared ports", () => {
    const input = fixture(["read.humidity_pct", "read.illuminance_lux"]);
    const extra = structuredClone(input.parts.find(p => p.id === "P-001")!);
    extra.id = "P-003";
    extra.software.capabilities = ["read.illuminance_lux"];
    input.parts.push(extra);
    expect(infeasible(input).diagnostics.some(d => d.constraint === "i2c")).toBe(true);
    extra.electrical.i2c_address = "0x23";
    expect(best(input).wiring_graph.peripherals.map(e => e.port)).toEqual(["i2c", "i2c"]);
  });
});

describe("determinism, validation and bounds", () => {
  it("does not mutate inputs and ignores input order", () => {
    const input = fixture();
    const original = structuredClone(input);
    const expected = solve(input);
    expect(input).toEqual(original);
    input.parts.reverse(); input.connectors.reverse(); input.profiles.reverse(); input.compat.reverse();
    for (const p of input.profiles) { p.ports.reverse(); p.activity.reverse(); }
    expect(solve(input)).toEqual(expected);
  });
  it("ranks feasible assignments by BOM before current draw", () => {
    const input = fixture();
    expect(best(input).part_versions.map(p => p.id)).toContain("P-002");
    input.parts.find(p => p.id === "P-001")!.commerce.unit_cost_usd = 1;
    expect(best(input).part_versions.map(p => p.id)).toContain("P-001");
  });
  it("never claims infeasibility or optimality after the search budget expires", () => {
    expect(solve({ ...fixture(), max_steps: 1 })).toEqual({ status: "search_limit", steps: 1 });
  });
  it("bounds conflict minimization with the same budget", () => {
    const input = fixture(["read.unobtainium_pct"]);
    const full = infeasible(input);
    expect(solve({ ...input, max_steps: full.steps - 1 }).status).toBe("search_limit");
  });
  it.each([NaN, Infinity, 0, -1])("rejects invalid interval %s", interval_s => {
    const input = fixture(); input.spec.interval_s = interval_s;
    expect(solve(input).status).toBe("invalid_input");
  });
  it("rejects duplicate pins and ambiguous compile tuples", () => {
    const input = fixture(); input.parts.push(input.parts[0]!);
    expect(solve(input).status).toBe("invalid_input");
    input.parts.pop(); input.compat.push({ ...input.compat[0]!, status: "failed" });
    expect(solve(input).status).toBe("invalid_input");
  });
  it("never installs two versions of the same part id", () => {
    const input = fixture(["read.humidity_pct", "read.illuminance_lux"]);
    const extra = structuredClone(input.parts.find(p => p.id === "P-001")!);
    extra.version = "2.0.0"; extra.software.capabilities = ["read.illuminance_lux"];
    extra.electrical.i2c_address = "0x23";
    input.parts.push(extra);
    infeasible(input);
  });
});
