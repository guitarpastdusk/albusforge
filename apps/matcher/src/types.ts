import { z } from "zod";
import { Capability, ConnectorDefinition, ConnectorId, PartDefinition, PartId, PartInterface, SemVer } from "@albusforge/schema";

export const PartPin = z.strictObject({ id: PartId, version: SemVer });
export type PartPin = z.infer<typeof PartPin>;
const Fraction = z.number().positive().max(1);
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

/**
 * A reviewed, versioned assembly/harness description, supplied by the caller.
 * PartDefinition alone has no host ports, adapter wiring or regulator losses.
 * Never infer them from the host's *input* connector or its capability names.
 */
export const AssemblyProfile = z.strictObject({
  id: z.string().min(1).max(120),
  version: SemVer,
  evidence: z.string().min(1).max(1000),
  brain: PartPin,
  source: PartPin,
  source_connector: ConnectorId,
  brain_input: z.string().min(1),
  /** Minimum measured conversion efficiency over this input voltage window. */
  regulator_efficiency: Fraction,
  /** Draw not already included in the part currents. */
  quiescent_source_ma: z.number().nonnegative(),
  /** Measured usable capacity above the brain's cutoff, including reserve. */
  battery_usable_fraction: Fraction,
  ports: z.array(z.strictObject({
    id: z.string().min(1),
    interface: PartInterface.exclude(["host", "power"]),
    connector: ConnectorId,
    rail: z.enum(["brain", "source"]),
    max_current_ma: Positive,
    /** Shared physical GPIOs cannot be allocated by two different ports. */
    resources: z.array(z.string().min(1)).min(1),
    /** Only I2C ports may host multiple peripherals. */
    capacity: z.number().int().min(1).max(112),
  })).max(32),
  /** Absent entries run continuously at active current; idle is never assumed. */
  activity: z.array(z.strictObject({ part: PartPin, active_s: z.number().nonnegative(), evidence: z.string().min(1) })).max(24),
}).superRefine((p, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  if (new Set(p.ports.map(x => x.id)).size !== p.ports.length) fail("port ids must be unique");
  for (const port of p.ports) {
    if (port.interface !== "i2c" && port.capacity !== 1) fail("only I2C ports can be shared");
    if (new Set(port.resources).size !== port.resources.length) fail("port resources must be unique");
  }
  if (new Set(p.activity.map(x => pinKey(x.part))).size !== p.activity.length) fail("activity pins must be unique");
});
export type AssemblyProfile = z.infer<typeof AssemblyProfile>;

export const CompatEntry = z.strictObject({
  driver_pkg: z.string().min(1), driver_ver: SemVer, runtime_ver: SemVer,
  brain_id: PartId, status: z.enum(["passed", "failed", "pending"]),
});
export type CompatEntry = z.infer<typeof CompatEntry>;

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
export interface WiringEdge { part: PartPin; port: string; rail: "brain" | "source"; connector: string; resources: string[] }
export interface PowerBudget {
  average_source_ma: number;
  peak_source_ma: number;
  peak_brain_rail_ma: number;
  usable_capacity_mah: number | null;
  estimated_life_days: number | null;
}
export interface BuildPlan {
  part_versions: PartPin[];
  runtime: string;
  profile: { id: string; version: string };
  wiring_graph: { source: PartPin; brain: PartPin; brain_input: string; peripherals: WiringEdge[] };
  power_budget: PowerBudget;
  bom: { part: PartPin; quantity: 1; unit_cost_usd: number }[];
  total_cost_usd: number;
  solver_log: string[];
}
export type SolveResult =
  | { status: "solved"; plans: BuildPlan[]; feasible_count: number; steps: number }
  | { status: "infeasible"; conflict_set: string[]; diagnostics: Failure[]; explanation: string; steps: number }
  | { status: "search_limit"; steps: number }
  | { status: "invalid_input"; issues: string[] };

export const pinKey = (p: PartPin): string => `${p.id}@${p.version}`;
export const pin = (p: PartPin): PartPin => ({ id: p.id, version: p.version });
export const compareText = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
