import type { PartDefinition } from "@albusforge/schema";
import type { AssemblyProfile, Failure, PowerBudget, SolveInput, WiringEdge } from "./types";
import { compareText, pin, pinKey } from "./types";
import { containsVoltage, powerBudget } from "./power";
import { satisfiesRuntime } from "./runtime";

export function checkParts(parts: PartDefinition[], brain: PartDefinition, input: SolveInput): Failure[] {
  const failures: Failure[] = [];
  const fail = (constraint: Failure["constraint"], detail: string) => failures.push({ constraint, detail });
  const capabilities = new Set(parts.flatMap(p => p.software.capabilities));
  const addresses = new Set<string>();
  for (const part of parts) {
    for (const need of part.electrical.requires) {
      if (!capabilities.has(need)) fail("requires", `${pinKey(part)} needs ${need}`);
      if ((need.startsWith("bus.") || need.startsWith("gpio.")) && !brain.software.capabilities.includes(need)) {
        fail("requires", `${brain.id} does not provide ${need}; bus expanders are not modeled`);
      }
    }
    for (const conflict of part.electrical.conflicts) {
      if (parts.some(p => p.id === conflict)) fail("conflict", `${part.id} conflicts with ${conflict}`);
    }
    const address = part.electrical.i2c_address;
    // One logical I2C bus in this core; no implicit multiplexers/address changes.
    if (address && addresses.has(address)) fail("i2c", `I2C address ${address} is used twice`);
    if (address) addresses.add(address);
    if (!satisfiesRuntime(input.spec.runtime, part.software.min_runtime)) {
      fail("runtime", `${pinKey(part)} needs runtime ${part.software.min_runtime}`);
    }
    if (part.software.driver_pkg !== null && !input.compat.some(row =>
      row.driver_pkg === part.software.driver_pkg && row.driver_ver === part.software.driver_version &&
      row.runtime_ver === input.spec.runtime && row.brain_id === brain.id && row.status === "passed")) {
      fail("compatibility", `No passed compile for ${pinKey(part)} on ${brain.id}/${input.spec.runtime}`);
    }
    if (part.electrical.interface !== "host" && part.electrical.interface !== "power" &&
      (!part.electrical.logic_v || !containsVoltage(part.electrical.logic_v, brain.electrical.logic_v!))) {
      fail("logic", `${pinKey(part)} cannot use ${brain.id}'s IO voltage without a modeled level shifter`);
    }
    const connector = input.connectors.find(c => c.id === part.electrical.connector);
    if (!connector || !connector.interfaces.includes(part.electrical.interface)) {
      fail("wiring", `Missing or incompatible connector definition for ${pinKey(part)}`);
    }
  }
  return failures;
}

export type WiringResult = { ok: true; wiring: WiringEdge[]; budget: PowerBudget } | { ok: false; failure: Failure };

/** Backtracking allocates real profile ports, including shared pin and rail budgets. */
export function wire(
  brain: PartDefinition, source: PartDefinition, peripherals: PartDefinition[],
  profile: AssemblyProfile, input: SolveInput, targetDays: number | undefined, step: () => void,
): WiringResult {
  const output = source.electrical.supply;
  const rail = brain.electrical.supply;
  const brainInput = profile.brain_input === "primary" ? brain.electrical.voltage_range
    : brain.electrical.alt_inputs?.find(p => p.name === profile.brain_input)?.voltage_range;
  if (!output || !rail || !brainInput) return { ok: false, failure: { constraint: "voltage", detail: `${profile.id} has no modeled power path` } };
  const sourceConnector = input.connectors.find(c => c.id === profile.source_connector);
  if (source.electrical.connector !== profile.source_connector || !sourceConnector || sourceConnector.max_voltage < output.output_v[1]) {
    return { ok: false, failure: { constraint: "wiring", detail: `${profile.id} does not match the source connector or voltage rating` } };
  }
  // A measured usable-capacity fraction can account for a battery's dropout.
  // Non-battery supplies must cover the input's full operating window.
  const battery = output.capacity_mah !== null && source.software.capabilities.includes("power.battery");
  if (output.output_v[1] > brainInput[1] || output.output_v[1] < brainInput[0] ||
    (!battery && output.output_v[0] < brainInput[0])) {
    return { ok: false, failure: { constraint: "voltage", detail: `${source.id} cannot power ${brain.id}/${profile.brain_input}` } };
  }
  const sourceWindow = [Math.max(output.output_v[0], brainInput[0]), output.output_v[1]];
  if (profile.brain_input === "primary") {
    const connector = input.connectors.find(c => c.id === brain.electrical.connector)!;
    if (connector.max_voltage < output.output_v[1]) return { ok: false, failure: { constraint: "voltage", detail: `${brain.id} input connector is overvolted` } };
  }
  const ports = [...profile.ports].sort((a, b) => compareText(a.id, b.id));
  const wiring: WiringEdge[] = [];
  let best: Extract<WiringResult, { ok: true }> | undefined;
  let failure: Failure = { constraint: "wiring", detail: `${profile.id} has no complete connector/port assignment` };
  function visit(index: number): void {
    step();
    if (index === peripherals.length) {
      const budget = powerBudget(brain, source, peripherals, wiring, profile, input.spec);
      if (!Object.values(budget).every(value => value === null || Number.isFinite(value))) {
        failure = { constraint: "current", detail: "Power calculation exceeds the numeric range" }; return;
      }
      if (budget.peak_brain_rail_ma > rail!.max_output_ma || budget.peak_source_ma > output!.max_output_ma) {
        failure = { constraint: "current", detail: `${profile.id} exceeds a source or regulator peak-current limit` }; return;
      }
      if (targetDays !== undefined && (budget.estimated_life_days === null || budget.estimated_life_days < targetDays)) {
        failure = { constraint: "battery", detail: `${profile.id} does not meet ${targetDays} days of battery life` }; return;
      }
      if (!best || budget.average_source_ma < best.budget.average_source_ma) {
        best = { ok: true, wiring: structuredClone(wiring), budget };
      }
      return;
    }
    const part = peripherals[index]!;
    for (const port of ports) {
      if (port.interface !== part.electrical.interface || port.connector !== part.electrical.connector) continue;
      const connector = input.connectors.find(c => c.id === port.connector);
      const voltage = port.rail === "brain" ? rail!.output_v : sourceWindow;
      if (!connector || !connector.interfaces.includes(port.interface) || connector.max_voltage < voltage[1]! ||
        !containsVoltage(part.electrical.voltage_range, voltage)) continue;
      // power.* requirements describe the actual powering rail, not another
      // unrelated component that happens to advertise that capability.
      const provider = port.rail === "brain" ? brain : source;
      if (part.electrical.requires.some(c => c.startsWith("power.") && !provider.software.capabilities.includes(c))) continue;
      const occupants = wiring.filter(edge => edge.port === port.id);
      if (occupants.length >= port.capacity) continue;
      if (wiring.some(edge => edge.port !== port.id && edge.resources.some(r => port.resources.includes(r)))) continue;
      const current = occupants.reduce((sum, edge) => sum + peripherals.find(p => pinKey(p) === pinKey(edge.part))!.electrical.current_draw_ma.active, part.electrical.current_draw_ma.active);
      if (current > port.max_current_ma) continue;
      wiring.push({ part: pin(part), port: port.id, rail: port.rail, connector: port.connector, resources: [...port.resources].sort(compareText) });
      visit(index + 1);
      wiring.pop();
    }
    return;
  }
  visit(0);
  return best ?? { ok: false, failure };
}
