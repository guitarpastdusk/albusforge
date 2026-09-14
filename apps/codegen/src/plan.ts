import { createHash } from "node:crypto";
import {
  BuildPlanMetadata,
  BuildPlanV1,
  Spec,
  serializeBuildPlanInput,
} from "@albusforge/schema";
import { candidateInterval } from "./candidate";
export function decodePlan(row: {
  metadata: unknown;
  part_versions: unknown;
  wiring_graph: unknown;
  power_budget: unknown;
  bom: unknown;
  solver_log: unknown;
  spec_data: unknown;
}) {
  const metadata = BuildPlanMetadata.parse(row.metadata);
  const plan = BuildPlanV1.parse({
    part_versions: row.part_versions,
    wiring_graph: row.wiring_graph,
    power_budget: row.power_budget,
    bom: row.bom,
    solver_log: row.solver_log,
    runtime: metadata.runtime,
    profile: metadata.profile,
    total_cost_usd: metadata.total_cost_usd,
  });
  const spec = Spec.parse(row.spec_data);
  if (
    createHash("sha256")
      .update(
        serializeBuildPlanInput({
          spec: row.spec_data,
          runtime: metadata.runtime,
          evidence: metadata.evidence,
        }),
      )
      .digest("hex") !== metadata.input_digest
  )
    throw new Error("Accepted plan input identity mismatch");
  return {
    plan,
    metadata,
    interval_s: candidateInterval(plan, metadata, spec),
  };
}
