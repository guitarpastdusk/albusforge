import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { test, expect, type Stack } from "./stack";
import type { Page, Route } from "@playwright/test";
/**
 * Continue a route, tolerating the one race we cannot remove: a handler that
 * holds a request open loses it if the page navigates or the context closes
 * while it waits, and continuing then throws "Route is already handled!".
 * Nothing is being suppressed — the request is gone either way — but the throw
 * would surface as an unrelated assertion failure further down the test.
 * Any other route error still fails the test.
 */
async function settle(route: Route): Promise<void> {
  try {
    await route.continue();
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("already handled")) throw error;
  }
}

async function signIn(page: Page, stack: Stack, email: string) {
  await page.goto(`${stack.webUrl}/signin?next=%2Fprojects`);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await page.getByLabel("6-digit code").fill(await stack.codeFor(email));
  await page.getByRole("button", { name: "Verify & sign in" }).click();
  await expect(page).toHaveURL(`${stack.webUrl}/projects`);
}
test("workspace switch clears both tabs, isolates another session, and reconciles uncertain failure", async ({ page, context, browser, stack }, info) => {
  await info.attach("workspace-environment", { contentType: "application/json", body: JSON.stringify({ source: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), at: new Date().toISOString(), browser: browser.version(), mode: "production web + real gateway + disposable PostgreSQL; local email sink; fixtures seed workspace memberships/builds only" }) });
  const errors: string[]=[];page.on("pageerror", error => errors.push(error.message));
  await context.route("**/*", route => new URL(route.request().url()).origin === stack.webUrl ? route.continue() : route.abort());
  const email="workspace-owner@example.test";await signIn(page, stack, email);
  const user=(await stack.pool.query("SELECT id FROM users.users WHERE email=$1", [email])).rows[0].id;
  const tenantA=(await stack.pool.query("SELECT active_tenant_id FROM users.sessions WHERE user_id=$1", [user])).rows[0].active_tenant_id;
  const tenantB=randomUUID();
  await stack.pool.query("INSERT INTO users.tenants(id,name) VALUES($1,'Team workspace')", [tenantB]);
  await stack.pool.query("INSERT INTO users.tenant_members(tenant_id,user_id,role) VALUES($1,$2,'viewer')", [tenantB,user]);
  await stack.pool.query("INSERT INTO builds.builds(tenant_id,ask_text) VALUES($1,'Only in Workspace A'),($2,'Only in Workspace B')", [tenantA,tenantB]);
  await page.reload();await expect(page.getByRole("heading", { name: "Only in Workspace A", exact: true })).toBeVisible();
  const peer=await context.newPage();peer.on("pageerror", error => errors.push(error.message));await peer.goto(`${stack.webUrl}/projects`);
  const independent=await browser.newContext();
  try {
    await independent.route("**/*", route => new URL(route.request().url()).origin === stack.webUrl ? route.continue() : route.abort());
    const separate=await independent.newPage();await signIn(separate, stack, email);await expect(separate.getByRole("heading", { name: "Only in Workspace A", exact: true })).toBeVisible();
    let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});let entered!:()=>void;const requested=new Promise<void>(resolve=>{entered=resolve;});let first=true;
    await page.route("**/*", async route => { if(first&&route.request().headers()["next-action"]){first=false;entered();await held;}await settle(route); });
    await page.getByLabel("Workspace", { exact:true }).filter({visible:true}).selectOption(tenantB);
    await page.getByRole("button",{name:"Switch",exact:true}).filter({visible:true}).click();await requested;
    await expect(page.getByRole("heading",{name:"Workspace transition"})).toBeVisible();
    await expect(peer.getByRole("heading",{name:"Workspace transition"})).toBeVisible();
    await expect(peer.getByRole("heading", { name: "Only in Workspace A", exact: true })).toHaveCount(0);
    release();
    for(const tab of [page,peer]){await expect(tab.getByRole("heading", { name: "Only in Workspace B", exact: true })).toBeVisible();await expect(tab.getByRole("heading", { name: "Only in Workspace A", exact: true })).toHaveCount(0);}
    await expect(separate.getByRole("heading", { name: "Only in Workspace A", exact: true })).toBeVisible();
    await page.screenshot({path:info.outputPath("workspace-switched.png"),fullPage:true});
    // A dropped mutation response is ambiguous to the UI: keep data unmounted
    // and reload the authoritative active workspace instead of restoring A/B.
    // `unroute` removes the handler without waiting for one that is mid-flight, so a
    // route still inside the held handler above could be continued after the page had
    // moved on — "Route is already handled!", and a flaky failure two assertions later.
    // `unrouteAll({behavior:"wait"})` drains the running handler first.
    await page.unrouteAll({ behavior: "wait" });let failed=false;
    await page.route("**/*", route=>{if(!failed&&route.request().headers()["next-action"]){failed=true;return route.abort("failed");}return settle(route);});
    await page.getByLabel("Workspace",{exact:true}).filter({visible:true}).selectOption(tenantA);
    await page.getByRole("button",{name:"Switch",exact:true}).filter({visible:true}).click();
    await expect(page.getByRole("button",{name:"Reload workspace"})).toBeVisible();
    await expect(page.getByRole("heading", { name: "Only in Workspace B", exact: true })).toHaveCount(0);
    await page.getByRole("button",{name:"Reload workspace"}).click();
    await expect(page.getByRole("heading", { name: "Only in Workspace B", exact: true })).toBeVisible();
    // Mobile selector and current role remain accessible without document overflow.
    await page.setViewportSize({width:320,height:900});await page.getByRole("button",{name:`Menu, signed in as ${email}`}).click();
    await expect(page.getByLabel("Workspace",{exact:true}).filter({visible:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:info.outputPath("workspace-mobile.png"),fullPage:true});
    expect(errors).toEqual([]);
  } finally {await independent.close();await peer.close();}
});

test('a peer hydrating after a completed switch must not retain old tenant content',async({page,context,stack})=>{
  const email='reviewer-hydration@example.test';
  await page.goto(stack.webUrl+'/signin?next=%2Fprojects');
  await page.getByLabel('Email',{exact:true}).fill(email);
  await page.getByRole('button',{name:'Email me a code'}).click();
  await page.getByLabel('6-digit code').fill(await stack.codeFor(email));
  await page.getByRole('button',{name:'Verify & sign in'}).click();
  await expect(page).toHaveURL(stack.webUrl+'/projects');
  const row=(await stack.pool.query('SELECT s.active_tenant_id,u.id FROM users.sessions s JOIN users.users u ON u.id=s.user_id WHERE u.email=$1',[email])).rows[0];
  const b=randomUUID();
  await stack.pool.query("INSERT INTO users.tenants(id,name) VALUES($1,'Review workspace B')",[b]);
  await stack.pool.query("INSERT INTO users.tenant_members(tenant_id,user_id,role) VALUES($1,$2,'viewer')",[b,row.id]);
  await stack.pool.query("INSERT INTO builds.builds(tenant_id,ask_text) VALUES($1,'Review private A'),($2,'Review private B')",[row.active_tenant_id,b]);
  await page.reload();
  await expect(page.getByRole('heading',{name:'Review private A',exact:true})).toBeVisible();
  const peer=await context.newPage();
  let release!:()=>void;const held=new Promise<void>(r=>release=r);
  await peer.route('**/_next/static/**/*.js',async route=>{await held;await route.continue();});
  try{
    await peer.goto(stack.webUrl+'/projects',{waitUntil:'commit'});
    await expect(peer.getByRole('heading',{name:'Checking workspace',exact:true})).toBeVisible();
    await expect(peer.getByRole('heading',{name:'Review private A',exact:true})).toHaveCount(0);
    await page.getByLabel('Workspace',{exact:true}).filter({visible:true}).selectOption(b);
    await page.getByRole('button',{name:'Switch',exact:true}).filter({visible:true}).click();
    await expect(page.getByRole('heading',{name:'Review private B',exact:true})).toBeVisible();
    release();
    await peer.waitForLoadState('networkidle');
    await peer.bringToFront();
    const staleA=await peer.getByRole('heading',{name:'Review private A',exact:true}).count();
    await peer.getByRole('link',{name:/albusforge/}).first().click();
    await expect(peer.getByRole('textbox',{name:'Describe the device you want'})).toBeVisible();
    const displayedWorkspace=await peer.getByLabel('Workspace',{exact:true}).filter({visible:true}).inputValue();
    await peer.getByRole('textbox',{name:'Describe the device you want'}).fill('Reviewer intended private workspace A');
    await peer.getByRole('button',{name:'Start building'}).click();
    await expect.poll(async()=> (await stack.pool.query('SELECT tenant_id FROM builds.builds WHERE ask_text=$1',['Reviewer intended private workspace A'])).rows.length).toBe(1);
    const writtenWorkspace=(await stack.pool.query('SELECT tenant_id FROM builds.builds WHERE ask_text=$1',['Reviewer intended private workspace A'])).rows[0].tenant_id;
    expect(displayedWorkspace).toBe(b);
    expect(staleA).toBe(0);
    expect(writtenWorkspace).toBe(displayedWorkspace);
  }finally{release();await peer.close();}
});

// Model an event missed after successful admission: the server still rejects
// the rendered A intent when the live session has advanced to B.
test("a missed switch cannot retarget a new build after client admission", async ({page, stack}) => {
  const email = "workspace-intent@example.test";
  await signIn(page, stack, email);
  const row = (await stack.pool.query("SELECT s.active_tenant_id,u.id FROM users.sessions s JOIN users.users u ON u.id=s.user_id WHERE u.email=$1", [email])).rows[0];
  const other = randomUUID();
  await stack.pool.query("INSERT INTO users.tenants(id,name) VALUES($1,'Intent B')", [other]);
  await stack.pool.query("INSERT INTO users.tenant_members(tenant_id,user_id,role) VALUES($1,$2,'viewer')", [other,row.id]);
  await page.goto(stack.webUrl);
  await expect(page.getByRole("button", {name:"Start building",exact:true})).toBeEnabled();
  await stack.pool.query("UPDATE users.sessions SET active_tenant_id=$1 WHERE user_id=$2", [other,row.id]);
  await page.getByLabel("Describe the device you want").fill("Must never be silently retargeted");
  await page.getByRole("button", {name:"Start building",exact:true}).click();
  await expect(page.getByRole("alert").filter({ hasText: "Your workspace changed" })).toContainText("Your workspace changed");
  expect((await stack.pool.query("SELECT id FROM builds.builds WHERE ask_text=$1", ["Must never be silently retargeted"])).rows).toEqual([]);
});
