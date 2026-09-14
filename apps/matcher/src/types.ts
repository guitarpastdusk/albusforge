import { z } from "zod";
import { Capability, ConnectorDefinition, PartDefinition, SemVer, AssemblyProfile, CompatEntry, PartPin } from "@albusforge/schema";

export { AssemblyProfile, CompatEntry, PartPin } from "@albusforge/schema";
export type { WiringEdge, PowerBudget } from "@albusforge/schema";
import type { BuildPlanV1 as BuildPlan } from "@albusforge/schema";
export type { BuildPlanV1 as BuildPlan } from "@albusforge/schema";
const Positive = z.number().positive();

/** Local core contract. The M2 adapter keeps pending shared-schema edits out of this package. */
export const SolveSpec = z.strictObject({
  capabilities: z.array(Capability).min(1).max(24),
  transport: z.enum(["wifi", "ble", "lora", "none"]),
  power_source: z.enum(["battery", "usb", "solar"]),
  interval_s: Positive,
  target_life_days: Positive.optional(),
  runtime: SemVer,
});
export type SolveSpec = z.infer<typeof SolveSpec>;

export const SolveInput = z.strictObject({
  spec: SolveSpec,
  parts: z.array(PartDefinition).max(24),
  connectors: z.array(ConnectorDefinition).max(64),
  profiles: z.array(AssemblyProfile).max(32),
  compat: z.array(CompatEntry).max(4096),
  max_steps: z.number().int().min(1).max(1_000_000).default(100_000),
  max_plans: z.number().int().min(1).max(20).default(3),
}).superRefine((input, ctx) => {
  const unique = (values: string[], what: string) => {
    if (new Set(values).size !== values.length) ctx.addIssue({ code: "custom", message: `duplicate ${what}` });
  };
  unique(input.parts.map(pinKey), "part pin");
  unique(input.connectors.map(x => x.id), "connector id");
  unique(input.profiles.map(x => `${x.id}@${x.version}`), "profile pin");
  unique(input.compat.map(x => `${x.driver_pkg}@${x.driver_ver}/${x.runtime_ver}/${x.brain_id}`), "compatibility tuple");
});
export type SolveInput = z.infer<typeof SolveInput>;

export type Constraint = "coverage" | "requires" | "conflict" | "i2c" | "runtime" | "compatibility" | "logic" | "wiring" | "voltage" | "current" | "battery" | "catalogue";
export interface Failure { constraint: Constraint; detail: string }
export type SolveResult =
  | { status: "solved"; plans: BuildPlan[]; feasible_count: number; steps: number }
  | { status: "infeasible"; conflict_set: string[]; diagnostics: Failure[]; explanation: string; steps: number }
  | { status: "search_limit"; steps: number }
  | { status: "invalid_input"; issues: string[] };

export const pinKey = (p: PartPin): string => `${p.id}@${p.version}`;
export const pin = (p: PartPin): PartPin => ({ id: p.id, version: p.version });
export const compareText = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
