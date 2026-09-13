import type { PartDefinition } from "@albusforge/schema";
import type { GoldenBuild } from "../golden-builds";

/** [min, max] volts. */
export type VoltageWindow = readonly [number, number];

/**
 * The window over which `source` can feed `input`, or null if it can't. The
 * source must never exceed the input's maximum. Below the input's minimum it
 * only stops working (a Li-ion cell sagging under a regulator's dropout), so
 * partial overlap is allowed, and the overlap is the usable window.
 */
export function usableWindow(source: VoltageWindow, input: VoltageWindow): VoltageWindow | null {
  if (source[1] > input[1]) return null;
  const low = Math.max(source[0], input[0]);
  return low <= source[1] ? [low, source[1]] : null;
}

export interface PowerAssignment {
  supply: string;
  brain: string;
  /** `primary` (the brain's connector) or one of its `alt_inputs`. */
  brain_input: string;
  /** The supply voltages over which the brain stays powered. */
  window: VoltageWindow;
  peripherals: { capability: string; part: string; rail: string; window: VoltageWindow }[];
}

export type PowerCheck = { ok: true; assignment: PowerAssignment } | { ok: false; problems: string[] };

const byId = (a: PartDefinition, b: PartDefinition) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const volts = (w: VoltageWindow) => `${w[0]}–${w[1]} V`;

/**
 * Finds one voltage-compatible way to power a golden build, lowest part ids
 * first so the answer is deterministic:
 * - the part providing `build.power.supply` feeds the brain input named by
 *   `build.power.brain_input`
 * - peripherals that require `power.5v` run from that supply, which must
 *   provide `power.5v`
 * - every other peripheral runs from the brain's regulated rail
 *   (`electrical.supply`)
 *
 * Voltage only. Connector fit and current budget are the matcher's (§7.2). A
 * required capability no part provides is skipped; the golden-build rule
 * already reports it.
 */
export function checkPowerPath(build: GoldenBuild, parts: readonly PartDefinition[]): PowerCheck {
  const { supply: supplyCapability, brain_input: inputName } = build.power;
  const supplies = parts
    .filter((p) => p.software.capabilities.includes(supplyCapability))
    .flatMap((p) => (p.electrical.supply ? [{ part: p, output: p.electrical.supply.output_v }] : []))
    .sort((a, b) => byId(a.part, b.part));
  const brains = parts.filter((p) => p.electrical.interface === "host").sort(byId);
  const needs = build.requires.filter((c) => c.startsWith("read.") || c.startsWith("act."));

  const problems: string[] = [];
  if (supplies.length === 0) problems.push(`no part supplies ${supplyCapability}`);
  if (brains.length === 0) problems.push("no host part");

  for (const { part: supply, output } of supplies) {
    for (const brain of brains) {
      const input =
        inputName === "primary"
          ? brain.electrical.voltage_range
          : brain.electrical.alt_inputs?.find((i) => i.name === inputName)?.voltage_range;
      if (!input) {
        problems.push(`${brain.id} has no "${inputName}" input`);
        continue;
      }
      const window = usableWindow(output, input);
      if (!window) {
        problems.push(`${supply.id} (${volts(output)}) can't feed ${brain.id} ${inputName} (${volts(input)})`);
        continue;
      }

      const brainRail = brain.electrical.supply?.output_v;
      const peripherals: PowerAssignment["peripherals"] = [];
      let complete = true;
      for (const capability of needs) {
        const candidates = parts.filter((p) => p.software.capabilities.includes(capability)).sort(byId);
        if (candidates.length === 0) continue;
        const found = candidates.flatMap((p) => {
          const fromSupply = p.electrical.requires.includes("power.5v");
          const rail = fromSupply ? (supply.software.capabilities.includes("power.5v") ? output : undefined) : brainRail;
          const w = rail ? usableWindow(rail, p.electrical.voltage_range) : null;
          return w ? [{ capability, part: p.id, rail: fromSupply ? supply.id : `${brain.id} rail`, window: w }] : [];
        })[0];
        if (found) {
          peripherals.push(found);
        } else {
          complete = false;
          problems.push(`no part providing ${capability} runs from ${supply.id} or ${brain.id}'s rail`);
        }
      }
      if (complete) {
        return { ok: true, assignment: { supply: supply.id, brain: brain.id, brain_input: inputName, window, peripherals } };
      }
    }
  }
  return { ok: false, problems: [...new Set(problems)] };
}
