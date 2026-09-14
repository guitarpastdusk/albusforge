import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { test, expect, type Stack } from "./stack";
import type { Page } from "@playwright/test";
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
    await page.route("**/*", async route => { if(first&&route.request().headers()["next-action"]){first=false;entered();await held;}await route.continue(); });
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
    await page.unroute("**/*");let failed=false;
    await page.route("**/*", route=>{if(!failed&&route.request().headers()["next-action"]){failed=true;return route.abort("failed");}return route.continue();});
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
