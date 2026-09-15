import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { solve } from "../../matcher/src/solver";
import { fixture } from "../../matcher/src/fixtures";
import { test, expect } from "./stack";

test("stored plan BOM, history and historical-spec refusal at desktop and mobile", async ({page,stack,browser},info)=>{
  await info.attach("plan-browser-environment",{contentType:"application/json",body:JSON.stringify({source:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),at:new Date().toISOString(),browser:browser.version(),mode:"production Next + actual gateway + PostgreSQL16; local email sink; stored plans/memberships are synthetic fixtures, real production profile manifest remains unavailable"})});
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  const email="plan-reader@example.test";
  await page.goto(`${stack.webUrl}/signin?next=%2Fprojects`);
  await page.getByLabel("Email",{exact:true}).fill(email);
  await page.getByRole("button",{name:"Email me a code"}).click();
  await page.getByLabel("6-digit code").fill(await stack.codeFor(email));
  await page.getByRole("button",{name:"Verify & sign in"}).click();
  await expect(page).toHaveURL(`${stack.webUrl}/projects`);
  const tenant=(await stack.pool.query("SELECT s.active_tenant_id FROM users.sessions s JOIN users.users u ON u.id=s.user_id WHERE u.email=$1",[email])).rows[0].active_tenant_id;
  const build=randomUUID(),input=fixture(),result=solve(input);
  if(result.status!=="solved")throw new Error("Synthetic browser plan fixture did not solve");
  const plan=result.plans[0]!;
  const metadata={schema_version:1,runtime:plan.runtime,profile:plan.profile,total_cost_usd:plan.total_cost_usd,input_digest:"a".repeat(64),evidence:{parts:input.parts.filter(part=>plan.part_versions.some(pin=>pin.id===part.id&&pin.version===part.version)),connectors:input.connectors,profile:input.profiles.find(profile=>profile.id===plan.profile.id),compat:input.compat}};
  await stack.pool.query("INSERT INTO builds.builds(id,tenant_id,ask_text,status) VALUES($1,$2,'Browser plan fixture','planning')",[build,tenant]);
  await stack.pool.query("INSERT INTO builds.specs(build_id,version,data,confidence) VALUES($1,1,'{}',1),($1,2,'{}',1)",[build]);
  for(const version of [1,2])await stack.pool.query(`INSERT INTO builds.plans(build_id,version,spec_version,part_versions,wiring_graph,power_budget,bom,solver_log,metadata)
    VALUES($1,$2,$2,$3,$4,$5,$6,$7,$8)`,[build,version,JSON.stringify(plan.part_versions),JSON.stringify(plan.wiring_graph),JSON.stringify(plan.power_budget),JSON.stringify(plan.bom),JSON.stringify(plan.solver_log),JSON.stringify(metadata)]);
  await page.goto(`${stack.webUrl}/projects/${build}/plan`);
  await expect(page.getByRole("heading",{name:"Build plan",exact:true})).toBeVisible();
  await expect(page.getByText("Historical spec — cannot accept",{exact:false})).toBeVisible();
  // The production catalogue now ships a reviewed profile and a runtime, so generating
  // is offered. Accepting a historical spec stays refused - that is the real guard here.
  await expect(page.getByRole("button",{name:"Generate plans",exact:true})).toBeEnabled();
  await expect(page.getByRole("button",{name:"Accept plan 2",exact:true})).toBeEnabled();
  await expect(page.getByRole("button",{name:"Accept plan 1",exact:true})).toHaveCount(0);
  for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:1000});
    await expect(page.getByRole("table")).toHaveCount(2);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:info.outputPath(`plan-${width}.png`),fullPage:true});
  }
  await page.getByText("Wiring, power and evidence",{exact:true}).first().click();
  await expect(page.getByText(`Evidence digest: ${metadata.input_digest}`,{exact:true}).first()).toBeVisible();
  expect(errors).toEqual([]);
});
