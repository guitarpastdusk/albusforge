import { createHash } from "node:crypto";
import { fromIntakeSpec, solve, SolveInput } from "@albusforge/matcher";
import { serializeBuildPlanInput, BuildPlanMetadata, BuildPlanPage, BuildPlanV1, CompatEntry, PartDefinition, PersistedBuildPlan, type BuildPlanEvidence, type BuildPlanRequest, type BuildPlanSolveResponse } from "@albusforge/schema";
import type { Pool, PoolClient } from "pg";
import { HttpError } from "./http";
import { withAuthorizedRead } from "./authorized-read";
import { withAuthorizedWrite } from "./authorized-write";
import { ReviewedPlanCatalogue, productionPlanCatalogue } from "./build-plan-catalogue";

interface PlanRow {
  build_id: string; version: number; spec_version: number; created_at: Date; accepted_at: Date | null;
  part_versions: unknown; wiring_graph: unknown; power_budget: unknown; bom: unknown; solver_log: unknown; metadata: unknown;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([key,item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
export const planInputDigest = (spec: unknown, runtime: string, evidence: BuildPlanEvidence): string => createHash("sha256").update(serializeBuildPlanInput({spec,runtime,evidence})).digest("hex");
export function decodeBuildPlan(row: PlanRow): PersistedBuildPlan | null {
  const metadata = BuildPlanMetadata.safeParse(row.metadata);
  if (!metadata.success) return null;
  const result = PersistedBuildPlan.safeParse({
    schema_version: 1, build_id: row.build_id, version: row.version, spec_version: row.spec_version,
    created_at: row.created_at.toISOString(), accepted_at: row.accepted_at?.toISOString() ?? null,
    metadata: metadata.data,
    plan: { part_versions: row.part_versions, wiring_graph: row.wiring_graph, power_budget: row.power_budget, bom: row.bom,
      solver_log: row.solver_log, runtime: metadata.data.runtime, profile: metadata.data.profile, total_cost_usd: metadata.data.total_cost_usd },
  });
  return result.success ? result.data : null;
}
const missing = () => new HttpError(404, "NOT_FOUND", "Build not found");
async function currentSpec(client: PoolClient, id: string) {
  return (await client.query<{version:number;data:unknown}>("SELECT version,data FROM builds.specs WHERE build_id=$1 ORDER BY version DESC LIMIT 1", [id])).rows[0];
}
async function trustedInput(client: PoolClient, catalogue: ReviewedPlanCatalogue, data: unknown): Promise<SolveInput | null> {
  if (catalogue.runtime === null || catalogue.profiles.length === 0) return null;
  let converted;
  try { converted = fromIntakeSpec(data, catalogue.runtime); } catch { throw new HttpError(409, "SPEC_NOT_SOLVABLE", "The current spec is not settled or includes constraints the planner cannot verify."); }
  const rows = await client.query<{definition:unknown}>("SELECT definition FROM registry.parts WHERE status='active' ORDER BY id,version LIMIT 25 FOR SHARE");
  const parts = rows.rows.map(row => PartDefinition.parse(row.definition));
  if (parts.length > 24 || parts.some(part => part.status !== "active")) return null;
  const compat = (await client.query("SELECT driver_pkg,driver_ver,runtime_ver,brain_id,status FROM registry.compat_matrix ORDER BY driver_pkg,driver_ver,runtime_ver,brain_id LIMIT 4097 FOR SHARE")).rows
    .flatMap(row => { const parsed = CompatEntry.safeParse(row); return parsed.success ? [parsed.data] : []; });
  const parsed = SolveInput.safeParse({ spec: converted, parts, connectors: catalogue.connectors, profiles: catalogue.profiles, compat, max_steps:100_000, max_plans:3 });
  return parsed.success ? parsed.data : null;
}
function evidenceFor(plan: BuildPlanV1, input: SolveInput): BuildPlanEvidence {
  const parts = input.parts.filter(part => plan.part_versions.some(pin => pin.id === part.id && pin.version === part.version));
  return { parts, connectors: input.connectors, profile: input.profiles.find(profile => profile.id === plan.profile.id && profile.version === plan.profile.version)!,
    compat: input.compat.filter(row => row.runtime_ver === plan.runtime && row.brain_id === plan.wiring_graph.brain.id && parts.some(part => part.software.driver_pkg === row.driver_pkg && part.software.driver_version === row.driver_ver)) };
}

export function createBuildPlanStore(pool: Pool, catalogueValue: ReviewedPlanCatalogue = productionPlanCatalogue) {
  // Validate and clone once; request bodies cannot mutate this trusted configuration.
  const catalogue = ReviewedPlanCatalogue.parse(catalogueValue);
  return {
    async list(cookie: string | undefined, host: string, id: string): Promise<BuildPlanPage> {
      return withAuthorizedRead(pool,cookie,host,async(client,identity) => {
        if (!(await client.query("SELECT 1 FROM builds.builds WHERE id=$1 AND tenant_id=$2",[id,identity.tenantId])).rowCount) throw missing();
        const spec = await currentSpec(client,id);
        const rows = (await client.query<PlanRow>("SELECT * FROM builds.plans WHERE build_id=$1 AND (version IN(SELECT version FROM builds.plans WHERE build_id=$1 ORDER BY version DESC LIMIT 20) OR (spec_version=$2 AND accepted_at IS NOT NULL)) ORDER BY version DESC",[id,spec?.version??null])).rows;
        return BuildPlanPage.parse({ build_id:id, current_spec_version:spec?.version??null, can_edit:["admin","operator"].includes(identity.role), catalogue_available:catalogue.runtime!==null&&catalogue.profiles.length>0,
          plans:rows.flatMap(row => { const plan = decodeBuildPlan(row); return plan ? [plan] : []; }) });
      });
    },
    async solve(cookie: string | undefined, host: string, id: string, body: BuildPlanRequest): Promise<BuildPlanSolveResponse> {
      return withAuthorizedWrite(pool,cookie,host,body.expected_tenant_id,async(client,identity) => {
        if (!(await client.query("SELECT 1 FROM builds.builds WHERE id=$1 AND tenant_id=$2 FOR UPDATE",[id,identity.tenantId])).rowCount) throw missing();
        await identity.recheckExpiry();
        const spec = await currentSpec(client,id);
        if (!spec || spec.version!==body.spec_version) throw new HttpError(409,"SPEC_CHANGED","The spec changed. Reload before generating a plan.");
        const input = await trustedInput(client,catalogue,spec.data);
        if (!input) return {status:"unavailable",explanation:"No approved assembly profile and runtime are available for this catalogue. Hardware plans remain unavailable until reviewed evidence is supplied.",plans:[]};
        const result = solve(input);
        if (result.status!=="solved") return {status:result.status==="search_limit"?"search_limit":"infeasible",explanation:result.status==="infeasible"?result.explanation:"The bounded planner could not establish a feasible plan.",plans:[]};
        let version = Number((await client.query("SELECT coalesce(max(version),0) AS version FROM builds.plans WHERE build_id=$1",[id])).rows[0].version);
        const stored: PersistedBuildPlan[] = [];
        for (const raw of result.plans) {
          const plan = BuildPlanV1.parse(raw), evidence = evidenceFor(plan,input);
          const metadata = BuildPlanMetadata.parse({schema_version:1,runtime:plan.runtime,profile:plan.profile,total_cost_usd:plan.total_cost_usd,input_digest:planInputDigest(spec.data,plan.runtime,evidence),evidence});
          let row = (await client.query<PlanRow>("SELECT * FROM builds.plans WHERE build_id=$1 AND spec_version=$2 AND metadata->>'input_digest'=$3 ORDER BY version LIMIT 1",[id,spec.version,metadata.input_digest])).rows[0];
          if (!row) row = (await client.query<PlanRow>(`INSERT INTO builds.plans(build_id,version,spec_version,part_versions,wiring_graph,power_budget,bom,solver_log,metadata)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[id,++version,spec.version,JSON.stringify(plan.part_versions),JSON.stringify(plan.wiring_graph),JSON.stringify(plan.power_budget),JSON.stringify(plan.bom),JSON.stringify(plan.solver_log),JSON.stringify(metadata)])).rows[0]!;
          const decoded = decodeBuildPlan(row);
          if (!decoded) throw new HttpError(409,"PLAN_UNAVAILABLE","Stored plan requires regeneration.");
          stored.push(decoded);
        }
        return {status:"solved",explanation:"Plans use pinned registry definitions and reviewed assembly evidence. Acceptance does not create firmware or prove a physical assembly.",plans:stored};
      });
    },
    async accept(cookie: string | undefined, host: string, id: string, version: number, body: BuildPlanRequest): Promise<PersistedBuildPlan> {
      return withAuthorizedWrite(pool,cookie,host,body.expected_tenant_id,async(client,identity) => {
        if (!(await client.query("SELECT 1 FROM builds.builds WHERE id=$1 AND tenant_id=$2 FOR UPDATE",[id,identity.tenantId])).rowCount) throw missing();
        await identity.recheckExpiry();
        const spec = await currentSpec(client,id);
        if (!spec || spec.version!==body.spec_version) throw new HttpError(409,"SPEC_CHANGED","The spec changed. Reload before accepting a plan.");
        const row = (await client.query<PlanRow>("SELECT * FROM builds.plans WHERE build_id=$1 AND version=$2",[id,version])).rows[0];
        const plan = row && decodeBuildPlan(row);
        if (!plan || plan.spec_version!==spec.version) throw new HttpError(409,"PLAN_UNAVAILABLE","Choose a plan for the current spec.");
        // A replay returns the recorded decision, not a new approval of mutable evidence.
        if (plan.accepted_at) return plan;
        const input = await trustedInput(client,catalogue,spec.data);
        if (!input) throw new HttpError(409,"PLAN_UNAVAILABLE","Approved assembly evidence is unavailable.");
        const result = solve({...input,parts:input.parts.filter(part=>plan.plan.part_versions.some(pin=>pin.id===part.id&&pin.version===part.version)),profiles:input.profiles.filter(profile=>profile.id===plan.plan.profile.id&&profile.version===plan.plan.profile.version)});
        const verified = result.status==="solved" && result.plans.find(candidate=>canonical(candidate)===canonical(plan.plan));
        if (!verified || planInputDigest(spec.data,plan.plan.runtime,plan.metadata.evidence)!==plan.metadata.input_digest || planInputDigest(spec.data,plan.plan.runtime,evidenceFor(plan.plan,input))!==plan.metadata.input_digest) throw new HttpError(409,"EVIDENCE_CHANGED","Plan evidence changed. Generate a new plan before accepting.");
        if ((await client.query("SELECT 1 FROM builds.plans WHERE build_id=$1 AND spec_version=$2 AND accepted_at IS NOT NULL",[id,spec.version])).rowCount) throw new HttpError(409,"PLAN_ALREADY_ACCEPTED","A plan is already accepted for this spec. Create a new spec revision to replace it.");
        const accepted = (await client.query<PlanRow>("UPDATE builds.plans SET accepted_at=clock_timestamp(),accepted_by=$3 WHERE build_id=$1 AND version=$2 RETURNING *",[id,version,identity.userId])).rows[0]!;
        return decodeBuildPlan(accepted)!;
      });
    },
  };
}
