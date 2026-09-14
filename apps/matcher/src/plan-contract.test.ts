import { expect, it } from "vitest";
import { serializeBuildPlanInput, BuildPlanMetadata, BuildPlanV1, PersistedBuildPlan } from "@albusforge/schema";
import { fixture } from "./fixtures";
import { solve } from "./solver";

it("round-trips actual solver output and its immutable evidence through the shared v1 contract", () => {
  const input = fixture();
  const result = solve(input);
  if (result.status !== "solved") throw new Error("Expected synthetic fixture to solve");
  const plan = BuildPlanV1.parse(result.plans[0]);
  const profile = input.profiles.find(value => value.id === plan.profile.id)!;
  const metadata = BuildPlanMetadata.parse({
    schema_version: 1, runtime: plan.runtime, profile: plan.profile,
    total_cost_usd: plan.total_cost_usd, input_digest: "a".repeat(64),
    evidence: { parts: input.parts.filter(value => plan.part_versions.some(pin => pin.id === value.id && pin.version === value.version)), connectors: input.connectors, profile, compat: input.compat },
  });
  const persisted = { schema_version: 1, build_id: "11111111-1111-4111-8111-111111111111", version: 1, spec_version: 1, created_at: "2026-09-13T00:00:00Z", accepted_at: null, plan, metadata };
  const identity = serializeBuildPlanInput({spec:{b:2,a:1},runtime:plan.runtime,evidence:metadata.evidence});
  expect(serializeBuildPlanInput({spec:{a:1,b:2},runtime:plan.runtime,evidence:metadata.evidence})).toBe(identity);
  expect(serializeBuildPlanInput({spec:{a:1,b:3},runtime:plan.runtime,evidence:metadata.evidence})).not.toBe(identity);
  expect(() => serializeBuildPlanInput({spec:{bad:Infinity},runtime:plan.runtime,evidence:metadata.evidence})).toThrow("finite JSON");
  expect(PersistedBuildPlan.parse(JSON.parse(JSON.stringify(persisted)))).toEqual(persisted);
  expect(PersistedBuildPlan.safeParse({ ...persisted, metadata: null }).success).toBe(false);
  expect(PersistedBuildPlan.safeParse({ ...persisted, schema_version: 2 }).success).toBe(false);
  expect(BuildPlanMetadata.safeParse({ ...metadata, evidence: { ...metadata.evidence, compat: [{ ...metadata.evidence.compat[0], status: "compiled" }] } }).success).toBe(false);
  expect(BuildPlanV1.safeParse({ ...plan, total_cost_usd: Infinity }).success).toBe(false);
  expect(BuildPlanV1.safeParse({ ...plan, bom: [{ ...plan.bom[0], quantity: 0 }] }).success).toBe(false);
});
