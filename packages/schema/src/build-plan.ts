import { z } from "zod";
import { ConnectorDefinition } from "./connector";
import { ConnectorId, PartDefinition, PartId, PartInterface, SemVer } from "./part";

export const PartPin = z.strictObject({ id: PartId, version: SemVer });
export type PartPin = z.infer<typeof PartPin>;
const Fraction = z.number().positive().max(1);
const Positive = z.number().positive();

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
  if (new Set(p.activity.map(x => `${x.part.id}@${x.part.version}`)).size !== p.activity.length) fail("activity pins must be unique");
});
export type AssemblyProfile = z.infer<typeof AssemblyProfile>;

export const CompatEntry = z.strictObject({
  driver_pkg: z.string().min(1), driver_ver: SemVer, runtime_ver: SemVer,
  brain_id: PartId, status: z.enum(["passed", "failed", "pending"]),
});
export type CompatEntry = z.infer<typeof CompatEntry>;

export const WiringEdge = z.strictObject({
  part: PartPin, port: z.string().min(1), rail: z.enum(["brain", "source"]),
  connector: ConnectorId, resources: z.array(z.string().min(1)),
});
export type WiringEdge = z.infer<typeof WiringEdge>;
export const PowerBudget = z.strictObject({
  average_source_ma: z.number().nonnegative(), peak_source_ma: z.number().nonnegative(),
  peak_brain_rail_ma: z.number().nonnegative(), usable_capacity_mah: Positive.nullable(),
  estimated_life_days: z.number().nonnegative().nullable(),
});
export type PowerBudget = z.infer<typeof PowerBudget>;
export const BuildPlanV1 = z.strictObject({
  part_versions: z.array(PartPin).min(2).max(24), runtime: SemVer,
  profile: z.strictObject({ id: z.string().min(1).max(120), version: SemVer }),
  wiring_graph: z.strictObject({ source: PartPin, brain: PartPin, brain_input: z.string().min(1), peripherals: z.array(WiringEdge).max(24) }),
  power_budget: PowerBudget,
  bom: z.array(z.strictObject({ part: PartPin, quantity: z.literal(1), unit_cost_usd: z.number().nonnegative() })).min(2).max(24),
  total_cost_usd: z.number().nonnegative(), solver_log: z.array(z.string()).max(256),
});
export type BuildPlanV1 = z.infer<typeof BuildPlanV1>;

/** Immutable evidence needed by downstream consumers; current registry rows are not substitutes. */
export const BuildPlanEvidence = z.strictObject({
  parts: z.array(PartDefinition).min(2).max(24),
  connectors: z.array(ConnectorDefinition).max(64),
  profile: AssemblyProfile,
  compat: z.array(CompatEntry).max(4096),
});
export type BuildPlanEvidence = z.infer<typeof BuildPlanEvidence>;
export const BuildPlanMetadata = z.strictObject({
  schema_version: z.literal(1), runtime: SemVer,
  profile: z.strictObject({ id: z.string().min(1).max(120), version: SemVer }),
  total_cost_usd: z.number().nonnegative(), input_digest: z.string().regex(/^[a-f0-9]{64}$/),
  evidence: BuildPlanEvidence,
});
export type BuildPlanMetadata = z.infer<typeof BuildPlanMetadata>;
export const PersistedBuildPlan = z.strictObject({
  schema_version: z.literal(1), build_id: z.uuid(), version: z.number().int().positive(),
  spec_version: z.number().int().positive(), created_at: z.iso.datetime({ offset: true }),
  accepted_at: z.iso.datetime({ offset: true }).nullable(), plan: BuildPlanV1,
  metadata: BuildPlanMetadata,
});
export type PersistedBuildPlan = z.infer<typeof PersistedBuildPlan>;

export const BuildPlanRequest = z.strictObject({ expected_tenant_id: z.uuid(), spec_version: z.number().int().positive() });
export type BuildPlanRequest = z.infer<typeof BuildPlanRequest>;
export const BuildPlanPage = z.strictObject({
  build_id: z.uuid(), current_spec_version: z.number().int().positive().nullable(),
  can_edit: z.boolean(), catalogue_available: z.boolean(), plans: z.array(PersistedBuildPlan).max(21),
});
export type BuildPlanPage = z.infer<typeof BuildPlanPage>;
export const BuildPlanSolveResponse = z.strictObject({
  status: z.enum(["solved", "unavailable", "infeasible", "search_limit"]),
  explanation: z.string(), plans: z.array(PersistedBuildPlan).max(3),
});
export type BuildPlanSolveResponse = z.infer<typeof BuildPlanSolveResponse>;

/** Canonical JSON identity, not approval: consumers hash these UTF-8 bytes with SHA-256. */
export function serializeBuildPlanInput(input: { spec: unknown; runtime: string; evidence: BuildPlanEvidence }): string {
  const encode = (value: unknown): string => {
    if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
    if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(encode).join(",")}]`;
    if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
      return `{${Object.entries(value).filter(([,item]) => item !== undefined).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([key,item]) => `${JSON.stringify(key)}:${encode(item)}`).join(",")}}`;
    }
    throw new Error("Plan identity must contain only finite JSON data");
  };
  return encode({ spec: input.spec, runtime: input.runtime, evidence: input.evidence });
}
