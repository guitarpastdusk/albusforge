// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { BuildPlanPanel } from "./BuildPlanPanel";
import { generateBuildPlans, acceptBuildPlan } from "@/actions/build-plans";
import type { BuildPlanPage, PersistedBuildPlan } from "@albusforge/schema";
vi.mock("@/actions/build-plans",()=>({generateBuildPlans:vi.fn(),acceptBuildPlan:vi.fn()}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const build="11111111-1111-4111-8111-111111111111",tenant="22222222-2222-4222-8222-222222222222";
// Deliberately presentation-only fixture. Real solver/evidence validation is in PG tests.
const plan={schema_version:1,build_id:build,version:4,spec_version:3,created_at:"2026-09-13T00:00:00Z",accepted_at:null,
  plan:{runtime:"0.1.0",profile:{id:"synthetic",version:"1.0.0"},total_cost_usd:12,bom:[{part:{id:"C-001",version:"1.0.0"},quantity:1,unit_cost_usd:12}],
    wiring_graph:{brain:{id:"C-001",version:"1.0.0"},source:{id:"E-001",version:"1.0.0"},brain_input:"test",peripherals:[]},
    power_budget:{average_source_ma:12,peak_source_ma:100,estimated_life_days:null},solver_log:[]},
  metadata:{evidence:{profile:{evidence:"Synthetic DOM fixture only"}},input_digest:"a".repeat(64)}} as unknown as PersistedBuildPlan;
const page:BuildPlanPage={build_id:build,current_spec_version:3,can_edit:true,catalogue_available:true,plans:[]};
let root:Root,container:HTMLDivElement;
beforeEach(()=>{vi.mocked(generateBuildPlans).mockReset();vi.mocked(acceptBuildPlan).mockReset();container=document.createElement("div");document.body.appendChild(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
async function render(value=page){await act(async()=>root.render(<BuildPlanPanel key={JSON.stringify(value)} page={value} tenantId={tenant}/>));}
const button=(text:string)=>Array.from(container.querySelectorAll("button")).find(element=>element.textContent===text)!;
it("generates a pinned BOM then accepts the exact rendered workspace/spec and plan version",async()=>{
  vi.mocked(generateBuildPlans).mockResolvedValue({ok:true,data:{status:"solved",explanation:"Fixture generated",plans:[plan]}});
  vi.mocked(acceptBuildPlan).mockResolvedValue({ok:true,data:{...plan,accepted_at:"2026-09-13T00:01:00Z"}});
  await render();await act(async()=>button("Generate plans").click());
  expect(generateBuildPlans).toHaveBeenCalledWith({buildId:build,expectedTenantId:tenant,specVersion:3});
  expect(container.querySelector("caption")?.textContent).toBe("Bill of materials");
  expect(container.textContent).toContain("C-001@1.0.0");
  await act(async()=>button("Accept plan 4").click());
  expect(acceptBuildPlan).toHaveBeenCalledWith({buildId:build,expectedTenantId:tenant,specVersion:3},4);
  expect(container.textContent).toContain("Plan accepted for this spec revision");
  expect(button("Accept plan 4")).toBeUndefined();
});
it("does not offer acceptance for historical plans or mutation to a viewer/unavailable catalogue",async()=>{
  await render({...page,plans:[{...plan,spec_version:2}]});expect(button("Accept plan 4")).toBeUndefined();expect(container.textContent).toContain("Historical spec");
  await render({...page,can_edit:false,plans:[plan]});expect(button("Generate plans").disabled).toBe(true);expect(button("Accept plan 4").disabled).toBe(true);
  await render({...page,catalogue_available:false,plans:[plan]});expect(button("Generate plans").disabled).toBe(true);expect(button("Accept plan 4").disabled).toBe(true);
});
it("keeps the existing plan and offers reload after uncertain acceptance without inventing success",async()=>{
  vi.mocked(acceptBuildPlan).mockRejectedValue(new Error("private gateway body"));
  await render({...page,plans:[plan]});await act(async()=>button("Accept plan 4").click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("couldn’t reach");
  expect(container.textContent).not.toContain("private gateway body");expect(button("Reload project")).toBeDefined();expect(button("Accept plan 4")).toBeDefined();
});
