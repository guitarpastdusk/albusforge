import type { PartDefinition } from "@albusforge/schema";
import { SolveInput, compareText, pin, pinKey } from "./types";
import type { BuildPlan, Failure, SolveResult } from "./types";
import { checkParts, wire } from "./constraints";
import { comparePlans } from "./rank";
import { explain } from "./explain";

const SEARCH_LIMIT = Symbol("search limit");
const powerCapability = { battery: "power.battery", usb: "power.5v", solar: "power.solar" } as const;

/** Pure, bounded search. Invalid or incomplete evidence never produces a plan. */
export function solve(value: unknown): SolveResult {
  const parsed = SolveInput.safeParse(value);
  if (!parsed.success) return { status: "invalid_input", issues: parsed.error.issues.map(x => `${x.path.join(".")}: ${x.message}`) };
  const input = parsed.data;
  const { spec } = input;
  if (spec.target_life_days !== undefined && spec.power_source !== "battery") {
    return { status: "invalid_input", issues: ["target_life_days requires a battery power source"] };
  }
  const parts = input.parts.filter(p => p.status === "active").sort((a, b) => compareText(pinKey(a), pinKey(b)));
  const profiles = [...input.profiles].sort((a, b) => compareText(`${a.id}@${a.version}`, `${b.id}@${b.version}`));
  const caps = [...new Set([...spec.capabilities, ...(spec.transport === "none" ? [] : [`net.${spec.transport}`])])].sort(compareText);
  const requirements = [...caps.map(c => `capability:${c}`), ...(spec.target_life_days === undefined ? [] : ["target_life_days"])];
  let steps = 0;
  const step = () => { if (steps >= input.max_steps) throw SEARCH_LIMIT; steps++; };
  const diagnostics = new Map<string, Failure>();
  const record = (f: Failure) => { if (diagnostics.size < 100) diagnostics.set(`${f.constraint}:${f.detail}`, f); };

  function search(needs: string[], firstOnly: boolean): { plans: BuildPlan[]; count: number } {
    const required = needs.filter(n => n.startsWith("capability:")).map(n => n.slice(11));
    const target = needs.includes("target_life_days") ? spec.target_life_days : undefined;
    const plans: BuildPlan[] = [];
    let count = 0;
    for (const profile of profiles) {
      step();
      const brain = parts.find(p => pinKey(p) === pinKey(profile.brain) && p.electrical.interface === "host");
      const source = parts.find(p => pinKey(p) === pinKey(profile.source) && p.electrical.interface === "power" &&
        p.software.capabilities.includes(powerCapability[spec.power_source]));
      if (!brain || !source || brain.id === source.id || (spec.power_source === "battery" && !source.electrical.supply?.capacity_mah)) continue;
      // One host, one source, and one instance of each part id. Additional power
      // converters/chargers need an explicit future multi-rail model.
      const candidates = parts.filter(p => p.electrical.interface !== "host" && p.electrical.interface !== "power" && p.id !== brain.id && p.id !== source.id);
      const selected: PartDefinition[] = [brain, source];
      const baseFailures = checkParts(selected, brain, input).filter(f => f.constraint !== "requires");
      if (baseFailures.length) { baseFailures.forEach(record); continue; }
      function visit(index: number): boolean {
        step();
        const available = new Set([...selected, ...candidates.slice(index)].flatMap(p => p.software.capabilities));
        if (required.some(c => !available.has(c))) return false;
        if (index < candidates.length) {
          // Exclude first, ensuring extra parts aren't implicitly required.
          if (visit(index + 1) && firstOnly) return true;
          const candidate = candidates[index]!;
          if (!selected.some(p => p.id === candidate.id)) {
            selected.push(candidate);
            const found = visit(index + 1);
            selected.pop();
            if (found && firstOnly) return true;
          }
          return false;
        }
        const failures = checkParts(selected, brain!, input);
        if (failures.length) { failures.forEach(record); return false; }
        const peripherals = selected.slice(2);
        const result = wire(brain!, source!, peripherals, profile, input, target, step);
        if (!result.ok) { record(result.failure); return false; }
        const ordered = [...selected].sort((a, b) => compareText(pinKey(a), pinKey(b)));
        const total = ordered.reduce((sum, p) => sum + p.commerce.unit_cost_usd!, 0);
        if (!Number.isFinite(total)) { record({ constraint: "catalogue", detail: "BOM cost exceeds the numeric range" }); return false; }
        const plan: BuildPlan = {
          part_versions: ordered.map(pin), runtime: spec.runtime,
          profile: { id: profile.id, version: profile.version },
          wiring_graph: { source: pin(source!), brain: pin(brain!), brain_input: profile.brain_input, peripherals: result.wiring },
          power_budget: result.budget,
          bom: ordered.map(p => ({ part: pin(p), quantity: 1, unit_cost_usd: p.commerce.unit_cost_usd! })),
          total_cost_usd: total,
          solver_log: [
            "Active registry pins only; all declared dependencies and requested capabilities covered.",
            "IO levels, I2C addresses, conflicts, runtime and exact passed compile tuples checked.",
            `Wiring and power evidence: ${profile.id}@${profile.version}: ${profile.evidence}`,
            "Unprofiled devices use continuous active current; peak load assumes simultaneous activity.",
            ...(profile.activity.filter(a => ordered.some(p => pinKey(p) === pinKey(a.part)))
              .sort((a, b) => compareText(pinKey(a.part), pinKey(b.part)))
              .map(a => `Duty ${pinKey(a.part)}: min(1, ${a.active_s}/${spec.interval_s}); ${a.evidence}`)),
            "Battery days = usable mAh / source mA / 24; runtime is an estimate within the profile's measured operating window.",
          ],
        };
        count++;
        plans.push(plan);
        plans.sort(comparePlans);
        if (plans.length > input.max_plans) plans.pop();
        return true;
      }
      if (visit(0) && firstOnly) return { plans, count };
    }
    return { plans, count };
  }

  try {
    const result = search(requirements, false);
    if (result.count) return { status: "solved", plans: result.plans, feasible_count: result.count, steps };
    for (const capability of caps) {
      if (!parts.some(p => p.software.capabilities.includes(capability))) record({ constraint: "coverage", detail: `No active part provides ${capability}` });
    }
    if (!diagnostics.size) record({ constraint: "catalogue", detail: "No active host/source/profile combination can cover this request" });
    // Deletion minimization gives an inclusion-minimal set, not necessarily
    // the smallest cardinality set. Structural/evidence constraints stay fixed.
    let conflict = [...requirements];
    for (const requirement of requirements) {
      const reduced = conflict.filter(r => r !== requirement);
      if (search(reduced, true).count === 0) conflict = reduced;
    }
    const failures = [...diagnostics.values()].sort((a, b) => compareText(`${a.constraint}:${a.detail}`, `${b.constraint}:${b.detail}`));
    return { status: "infeasible", conflict_set: conflict, diagnostics: failures, explanation: explain(conflict, failures), steps };
  } catch (error) {
    if (error === SEARCH_LIMIT) return { status: "search_limit", steps };
    throw error;
  }
}
