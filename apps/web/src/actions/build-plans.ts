"use server";
import { BuildPlanRequest, BuildPlanSolveResponse, PersistedBuildPlan } from "@albusforge/schema";
import { z } from "zod";
import { unstable_rethrow } from "next/navigation";
import { apiMutationAction } from "@/lib/api/server";
import { ApiRequestError } from "@/lib/api/core";
import type { ActionResult } from "@/lib/action-result";
const Target = z.strictObject({buildId:z.uuid(),expectedTenantId:z.uuid(),specVersion:z.number().int().positive()});
async function failure(error:unknown):Promise<{ok:false;message:string}>{
  unstable_rethrow(error);
  if(error instanceof ApiRequestError){
    if(error.status===401)return {ok:false,message:"Sign in again, then reload this project."};
    if(error.status===403)return {ok:false,message:"An operator or admin role is required to change a plan."};
    if(error.status===409)return {ok:false,message:"The workspace, spec or plan evidence changed. Reload the project before continuing."};
  }
  return {ok:false,message:"We couldn’t confirm the plan request. Reload to check its stored state before trying again."};
}
export async function generateBuildPlans(target:unknown):Promise<ActionResult<BuildPlanSolveResponse>>{
  const parsed=Target.safeParse(target);if(!parsed.success)return {ok:false,message:"Reload the current project and spec before generating plans."};
  try{return {ok:true,data:await apiMutationAction("POST",`/v1/builds/${parsed.data.buildId}/plans`,BuildPlanSolveResponse,
    BuildPlanRequest.parse({expected_tenant_id:parsed.data.expectedTenantId,spec_version:parsed.data.specVersion}))};}catch(error){return failure(error);}
}
export async function acceptBuildPlan(target:unknown,version:unknown):Promise<ActionResult<PersistedBuildPlan>>{
  const parsed=Target.safeParse(target),plan=z.number().int().positive().safeParse(version);
  if(!parsed.success||!plan.success)return {ok:false,message:"Choose a stored plan for the current spec."};
  try{return {ok:true,data:await apiMutationAction("POST",`/v1/builds/${parsed.data.buildId}/plans/${plan.data}/accept`,PersistedBuildPlan,
    BuildPlanRequest.parse({expected_tenant_id:parsed.data.expectedTenantId,spec_version:parsed.data.specVersion}))};}catch(error){return failure(error);}
}
