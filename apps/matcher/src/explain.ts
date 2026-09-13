import type { Failure } from "./types";

/** Conflict ids are machine-readable; this deterministic text is safe to show without a model. */
export function explain(conflicts: string[], diagnostics: Failure[]): string {
  if (conflicts.length === 0) return "No verified assembly can be built from this catalogue and its hardware/compile evidence. Add the missing evidence before changing the request.";
  const requirements = conflicts.map(c => c.startsWith("capability:") ? c.slice(11) : c).join(", ");
  return `These requirements cannot be met together: ${requirements}. Could you relax one or add a compatible part?${diagnostics.some(d => d.constraint === "battery") ? " A larger usable battery capacity or a longer sensing interval may help; either change must be solved again." : ""}`;
}
