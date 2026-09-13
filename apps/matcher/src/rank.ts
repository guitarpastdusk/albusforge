import type { BuildPlan } from "./types";
import { compareText, pinKey } from "./types";

/** Cost, then source draw, then part count; stable identifiers break ties. No LLM. */
export function comparePlans(a: BuildPlan, b: BuildPlan): number {
  return a.total_cost_usd - b.total_cost_usd ||
    a.power_budget.average_source_ma - b.power_budget.average_source_ma ||
    a.part_versions.length - b.part_versions.length ||
    compareText(a.part_versions.map(pinKey).join(","), b.part_versions.map(pinKey).join(",")) ||
    compareText(`${a.profile.id}@${a.profile.version}`, `${b.profile.id}@${b.profile.version}`);
}
