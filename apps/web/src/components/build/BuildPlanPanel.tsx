"use client";
import { useState } from "react";
import type { BuildPlanPage, PersistedBuildPlan } from "@albusforge/schema";
import { generateBuildPlans, acceptBuildPlan } from "@/actions/build-plans";
import { settle } from "@/lib/safe-action";
import { Button } from "@/components/ui";

const cost=(value:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(value);
export function BuildPlanPanel({page,tenantId}:{page:BuildPlanPage;tenantId:string}){
  const [plans,setPlans]=useState(page.plans),[pending,setPending]=useState(false),[message,setMessage]=useState<string|null>(null),[failed,setFailed]=useState(false);
  const current=page.current_spec_version;
  const target={buildId:page.build_id,expectedTenantId:tenantId,specVersion:current};
  const run=async(version?:number)=>{
    if(pending||current===null)return;
    setPending(true);setMessage(null);setFailed(false);
    if(version===undefined){
      const result=await settle(()=>generateBuildPlans(target));
      if(result.ok){setMessage(result.data.explanation);setPlans(previous=>[...result.data.plans,...previous.filter(plan=>!result.data.plans.some(next=>next.version===plan.version))]);}
      else{setFailed(true);setMessage(result.message);}
    }else{
      const result=await settle(()=>acceptBuildPlan(target,version));
      if(result.ok){setPlans(previous=>previous.map(plan=>plan.version===result.data.version?result.data:plan));setMessage("Plan accepted for this spec revision. Firmware and provisioning have separate eligibility checks.");}
      else{setFailed(true);setMessage(result.message);}
    }
    setPending(false);
  };
  const accepted=plans.find(plan=>plan.spec_version===current&&plan.accepted_at!==null);
  return <div className="mt-8 space-y-6">
    <section className="rounded-[24px] border border-hairline bg-white p-6" aria-labelledby="plan-availability">
      <h2 id="plan-availability" className="font-display text-[26px]">{current===null?"A settled spec comes first":`Spec revision ${current}`}</h2>
      <p className="mt-3 text-muted">Plans pin the selected parts, wiring, power assumptions and reviewed assembly evidence. Acceptance records a design decision; it does not create firmware or validate a physical assembly.</p>
      {!page.catalogue_available?<p className="mt-3 text-muted">No approved assembly profile and runtime are available in the current catalogue. Plan generation remains unavailable until reviewed evidence is supplied.</p>:null}
      {current===null?<p className="mt-3 text-muted">Continue the project conversation to save a settled specification.</p>:null}
      {!page.can_edit?<p className="mt-3 text-muted">You can review plans. An operator or admin can generate and accept them.</p>:null}
      <Button type="button" variant="coral" className="mt-5 rounded-xl px-5 py-3" disabled={pending||!page.can_edit||current===null||!page.catalogue_available||Boolean(accepted)} onClick={()=>void run()}>{pending?"Checking plan…":accepted?"Plan accepted":"Generate plans"}</Button>
    </section>
    {message?<div role={failed?"alert":"status"} className="rounded-xl border border-hairline bg-white p-5"><p>{message}</p>{failed?<button type="button" className="mt-3 underline" onClick={()=>window.location.reload()}>Reload project</button>:null}</div>:null}
    {plans.length===0?<p className="text-muted">No plans have been stored for this project.</p>:plans.map(plan=><PlanCard key={plan.version} plan={plan} current={current} canAccept={page.can_edit&&page.catalogue_available&&!accepted} pending={pending} accept={()=>void run(plan.version)}/>)}
  </div>;
}
function PlanCard({plan,current,canAccept,pending,accept}:{plan:PersistedBuildPlan;current:number|null;canAccept:boolean;pending:boolean;accept:()=>void}){
  const stale=plan.spec_version!==current;
  return <section className="min-w-0 rounded-[24px] border border-hairline bg-white p-4 sm:p-6" aria-labelledby={`plan-${plan.version}`}>
    <h2 id={`plan-${plan.version}`} className="break-words font-display text-[26px]">Plan {plan.version} · {cost(plan.plan.total_cost_usd)} parts estimate</h2>
    <p className="mt-2 text-muted">Spec {plan.spec_version} · {stale?"Historical spec — cannot accept":plan.accepted_at?"Accepted":"Available for review"}</p>
    <p className="mt-2 break-words text-sm text-muted">Runtime {plan.plan.runtime} · Profile {plan.plan.profile.id}@{plan.plan.profile.version}</p>
    <div className="mt-5 overflow-x-auto"><table className="w-full text-left text-sm"><caption className="mb-3 text-left font-semibold">Bill of materials</caption><thead><tr><th scope="col" className="py-2 pr-4">Part and version</th><th scope="col" aria-label="Quantity" className="px-2">Qty</th><th scope="col" className="pl-2">Unit estimate</th></tr></thead><tbody>{plan.plan.bom.map(item=><tr key={`${item.part.id}@${item.part.version}`} className="border-t border-hairline"><th scope="row" className="whitespace-nowrap py-3 pr-4 font-normal">{item.part.id}@{item.part.version}</th><td className="px-2">{item.quantity}</td><td className="pl-2">{cost(item.unit_cost_usd)}</td></tr>)}</tbody></table></div>
    <p className="mt-3 text-sm text-muted">These pinned registry costs are estimates, not a purchase quote.</p>
    <details className="mt-5"><summary className="cursor-pointer font-semibold">Wiring, power and evidence</summary><div className="mt-3 space-y-3 text-sm text-muted">
      <p>Brain {plan.plan.wiring_graph.brain.id} via {plan.plan.wiring_graph.brain_input}; source {plan.plan.wiring_graph.source.id}.</p>
      <ul className="space-y-2">{plan.plan.wiring_graph.peripherals.map(edge=><li key={`${edge.part.id}:${edge.port}`} className="break-words">{edge.part.id}@{edge.part.version} → {edge.port} ({edge.connector}, {edge.rail} rail; {edge.resources.join(", ")})</li>)}</ul>
      <p>Average source: {plan.plan.power_budget.average_source_ma.toFixed(2)} mA. Peak source: {plan.plan.power_budget.peak_source_ma.toFixed(2)} mA.</p>
      {plan.plan.power_budget.estimated_life_days!==null?<p>Estimated battery life: {plan.plan.power_budget.estimated_life_days.toFixed(1)} days within the profile’s measured assumptions.</p>:null}
      <p className="break-words">{plan.metadata.evidence.profile.evidence}</p>
      <ul className="space-y-2">{plan.plan.solver_log.map((line,index)=><li key={index}>{line}</li>)}</ul>
      <p className="break-all font-mono">Evidence digest: {plan.metadata.input_digest}</p>
    </div></details>
    {!stale&&!plan.accepted_at?<Button type="button" variant="dark" className="mt-5 rounded-xl px-5 py-3" disabled={!canAccept||pending} onClick={accept}>Accept plan {plan.version}</Button>:null}
  </section>;
}
