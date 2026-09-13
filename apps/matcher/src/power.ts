import type { PartDefinition } from "@albusforge/schema";
import type { AssemblyProfile, PowerBudget, SolveSpec, WiringEdge } from "./types";
import { pinKey } from "./types";

/** Entire source window must fit: neither overvoltage nor brownout is a valid plan. */
export const containsVoltage = (input: readonly number[], source: readonly number[]): boolean =>
  input[0]! <= source[0]! && source[1]! <= input[1]!;

export function averageCurrent(part: PartDefinition, interval: number, profile: AssemblyProfile): number {
  const activity = profile.activity.find(x => pinKey(x.part) === pinKey(part));
  const duty = activity ? Math.min(1, activity.active_s / interval) : 1;
  const { idle, active } = part.electrical.current_draw_ma;
  return idle + (active - idle) * duty;
}

/**
 * Currents are compared on their own rails. Refer regulated load power back
 * to source current at its minimum usable voltage, with measured losses.
 * All devices may be active together for peak checks, regardless of duty.
 */
export function powerBudget(
  brain: PartDefinition, source: PartDefinition, peripherals: PartDefinition[],
  wiring: WiringEdge[], profile: AssemblyProfile, spec: SolveSpec,
): PowerBudget {
  const input = profile.brain_input === "primary" ? brain.electrical.voltage_range
    : brain.electrical.alt_inputs!.find(x => x.name === profile.brain_input)!.voltage_range;
  const sourceMin = Math.max(source.electrical.supply!.output_v[0], input[0]);
  const railMax = brain.electrical.supply!.output_v[1];
  let railPeak = brain.electrical.current_draw_ma.active;
  let railAverage = averageCurrent(brain, spec.interval_s, profile);
  let directPeak = source.electrical.current_draw_ma.active;
  let directAverage = averageCurrent(source, spec.interval_s, profile);
  for (const part of peripherals) {
    if (wiring.find(x => pinKey(x.part) === pinKey(part))!.rail === "brain") {
      railPeak += part.electrical.current_draw_ma.active;
      railAverage += averageCurrent(part, spec.interval_s, profile);
    } else {
      directPeak += part.electrical.current_draw_ma.active;
      directAverage += averageCurrent(part, spec.interval_s, profile);
    }
  }
  const factor = railMax / (sourceMin * profile.regulator_efficiency);
  const average = directAverage + railAverage * factor + profile.quiescent_source_ma;
  const peak = directPeak + railPeak * factor + profile.quiescent_source_ma;
  const capacity = source.electrical.supply!.capacity_mah;
  const usable = capacity === null ? null : capacity * profile.battery_usable_fraction;
  return {
    average_source_ma: average, peak_source_ma: peak, peak_brain_rail_ma: railPeak,
    usable_capacity_mah: usable,
    estimated_life_days: usable === null || average === 0 ? null : usable / average / 24,
  };
}
