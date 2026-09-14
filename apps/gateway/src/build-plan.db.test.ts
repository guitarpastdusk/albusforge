import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createDb, type DbConfig } from "@albusforge/db";
import { runMigrations } from "@albusforge/db/migrate";
import { SESSION_COOKIE, PersistedBuildPlan } from "@albusforge/schema";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { fixture as solverFixture } from "../../matcher/src/fixtures";
import { buildApp } from "./app";
const input = solverFixture();
const settled = {settled:true,capabilities:input.spec.capabilities,sense:{interval_s:input.spec.interval_s},environment:{flags:[]},connect:{transport:input.spec.transport},power:{source:input.spec.power_source},open_questions:[]};
let container: StartedPostgreSqlContainer;
let handle: ReturnType<typeof createDb>;
let app: ReturnType<typeof buildApp>;
beforeAll(async()=>{
  container=await new PostgreSqlContainer("postgres:16-alpine").start();
  const admin=new pg.Client({connectionString:container.getConnectionUri()});await admin.connect();
  await admin.query("CREATE ROLE albus_migrate LOGIN CREATEROLE PASSWORD 'migration'");await admin.query("CREATE DATABASE albus OWNER albus_migrate");await admin.end();
  const config:DbConfig={host:container.getHost(),port:container.getPort(),database:"albus",user:"albus_migrate",password:"migration",ssl:"disable"};
  await runMigrations(config,{appRole:{name:"albus_app",password:"app"}});
  handle=createDb({...config,user:"albus_app",password:"app"},{max:6,statementTimeoutMs:3000,queryTimeoutMs:4000});
  app=buildApp({parts:{latest:async()=>[]},ping:async()=>{},log:()=>{},telemetryPool:handle.pool,
    planCatalogue:{schema_version:1,runtime:input.spec.runtime,profiles:input.profiles,connectors:input.connectors}});
});
afterAll(async()=>{await app?.close();await handle?.pool.end();await container?.stop();});
beforeEach(async()=>{
  await handle.pool.query("DELETE FROM registry.compat_matrix");await handle.pool.query("DELETE FROM registry.parts");
  for(const part of input.parts)await handle.pool.query("INSERT INTO registry.parts(id,version,status,definition) VALUES($1,$2,$3,$4)",[part.id,part.version,part.status,JSON.stringify(part)]);
  for(const row of input.compat)await handle.pool.query("INSERT INTO registry.compat_matrix(driver_pkg,driver_ver,runtime_ver,brain_id,status) VALUES($1,$2,$3,$4,$5)",[row.driver_pkg,row.driver_ver,row.runtime_ver,row.brain_id,row.status]);
});
async function owner(role="admin"){
  const tenant=randomUUID(),user=randomUUID(),session=randomUUID(),build=randomUUID(),token=randomBytes(32).toString("base64url");
  await handle.pool.query("INSERT INTO users.tenants(id,name) VALUES($1,'test')",[tenant]);
  await handle.pool.query("INSERT INTO users.users(id,email) VALUES($1,$2)",[user,`${user}@example.test`]);
  await handle.pool.query("INSERT INTO users.tenant_members(tenant_id,user_id,role) VALUES($1,$2,$3)",[tenant,user,role]);
  await handle.pool.query("INSERT INTO users.sessions(id,token_hash,user_id,active_tenant_id,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 hour')",[session,createHash("sha256").update(token).digest("hex"),user,tenant]);
  await handle.pool.query("INSERT INTO builds.builds(id,tenant_id,ask_text,status) VALUES($1,$2,'Synthetic temperature monitor','planning')",[build,tenant]);
  await handle.pool.query("INSERT INTO builds.specs(build_id,version,data,confidence) VALUES($1,1,$2,1)",[build,JSON.stringify(settled)]);
  const headers={cookie:`${SESSION_COOKIE}=${token}`,host:"localhost",origin:"http://localhost"};
  const post=(suffix="",overrides={})=>app.inject({method:"POST",url:`/v1/builds/${build}/plans${suffix}`,headers,payload:{expected_tenant_id:tenant,spec_version:1,...overrides}});
  return {tenant,user,session,build,headers,post};
}
async function solved(f:Awaited<ReturnType<typeof owner>>){
  const response=await f.post();expect(response.statusCode,response.body).toBe(200);expect(response.json().status).toBe("solved");
  return response.json().plans.map((plan:unknown)=>PersistedBuildPlan.parse(plan)) as PersistedBuildPlan[];
}
it("persists real solver outputs with exact immutable evidence, accepts idempotently and refuses replacement",async()=>{
  const f=await owner(), plans=await solved(f);
  expect(plans.length).toBeGreaterThan(1);
  expect((await solved(f)).map(plan=>plan.version)).toEqual(plans.map(plan=>plan.version));
  const accepted=await f.post(`/${plans[0]!.version}/accept`);expect(accepted.statusCode,accepted.body).toBe(200);
  expect(accepted.json().accepted_at).not.toBeNull();
  expect((await f.post(`/${plans[0]!.version}/accept`)).json()).toEqual(accepted.json());
  expect((await f.post(`/${plans[1]!.version}/accept`)).statusCode).toBe(409);
  expect((await handle.pool.query("SELECT accepted_by FROM builds.plans WHERE build_id=$1 AND accepted_at IS NOT NULL",[f.build])).rows).toEqual([{accepted_by:f.user}]);
});
it("keeps the real production profile manifest unavailable and rejects arbitrary browser solver inputs",async()=>{
  const f=await owner();
  const production=buildApp({parts:{latest:async()=>[]},ping:async()=>{},log:()=>{},telemetryPool:handle.pool});
  try{const response=await production.inject({method:"POST",url:`/v1/builds/${f.build}/plans`,headers:f.headers,payload:{expected_tenant_id:f.tenant,spec_version:1}});expect(response.json().status).toBe("unavailable");}finally{await production.close();}
  expect((await f.post("",{parts:input.parts})).statusCode).toBe(400);
  await handle.pool.query("UPDATE registry.parts SET status='draft'");
  expect((await f.post()).json().status).not.toBe("solved");
  expect((await handle.pool.query("SELECT 1 FROM builds.plans WHERE build_id=$1",[f.build])).rowCount).toBe(0);
});
it("fails closed when compatibility or persisted evidence no longer matches",async()=>{
  const f=await owner(),plans=await solved(f);
  await handle.pool.query("UPDATE registry.compat_matrix SET status='compiled'");
  expect((await f.post(`/${plans[0]!.version}/accept`)).statusCode).toBe(409);
  expect((await f.post()).json().status).toBe("infeasible");
});
it("permits viewer reads but protects writes, tenant intent and foreign build IDs",async()=>{
  const f=await owner("viewer"),other=await owner();
  const list=await app.inject({url:`/v1/builds/${f.build}/plans`,headers:f.headers});expect(list.statusCode).toBe(200);expect(list.json().can_edit).toBe(false);
  expect((await f.post()).statusCode).toBe(403);
  expect((await other.post("",{expected_tenant_id:f.tenant})).statusCode).toBe(409);
  expect((await app.inject({url:`/v1/builds/${other.build}/plans`,headers:f.headers})).statusCode).toBe(404);
  expect((await app.inject({method:"POST",url:`/v1/builds/${other.build}/plans`,headers:{...other.headers,origin:"https://foreign.test"},payload:{expected_tenant_id:other.tenant,spec_version:1}})).statusCode).toBe(403);
});
async function waitForLock(){
  for(let i=0;i<100;i++){if((await handle.pool.query("SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT 1 FROM builds.builds%'")).rowCount)return;await new Promise(resolve=>setTimeout(resolve,10));}
  throw new Error("Plan request did not reach the expected build lock");
}
it("observes a newer spec committed by a writer that wins the shared build lock",async()=>{
  const f=await owner(),plans=await solved(f),writer=await handle.pool.connect();
  try{
    await writer.query("BEGIN");await writer.query("SELECT 1 FROM builds.builds WHERE id=$1 FOR UPDATE",[f.build]);
    const pending=f.post(`/${plans[0]!.version}/accept`).then(value=>value);
    await waitForLock();
    await writer.query("INSERT INTO builds.specs(build_id,version,data,confidence) VALUES($1,2,$2,1)",[f.build,JSON.stringify(settled)]);
    await writer.query("COMMIT");
    const response=await pending;expect(response.statusCode).toBe(409);expect(response.json().error.code).toBe("SPEC_CHANGED");
    expect((await handle.pool.query("SELECT 1 FROM builds.plans WHERE build_id=$1 AND accepted_at IS NOT NULL",[f.build])).rowCount).toBe(0);
  }finally{await writer.query("ROLLBACK");writer.release();}
});
it("rechecks expiry after a blocked build lock and never accepts after the deadline",async()=>{
  const f=await owner(),plans=await solved(f),writer=await handle.pool.connect();
  await handle.pool.query("UPDATE users.sessions SET expires_at=clock_timestamp()+interval '500 milliseconds' WHERE id=$1",[f.session]);
  try{await writer.query("BEGIN");await writer.query("SELECT 1 FROM builds.builds WHERE id=$1 FOR UPDATE",[f.build]);
    const pending=f.post(`/${plans[0]!.version}/accept`).then(value=>value);await waitForLock();
    await writer.query("SELECT pg_sleep(0.6)");await writer.query("COMMIT");expect((await pending).statusCode).toBe(401);
  }finally{await writer.query("ROLLBACK");writer.release();}
});
it.each(["revocation","membership"])("rejects a concurrent %s that commits before admission",async kind=>{
  const f=await owner(),writer=await handle.pool.connect();
  try{await writer.query("BEGIN");
    if(kind==="revocation")await writer.query("UPDATE users.sessions SET revoked_at=now() WHERE id=$1",[f.session]);
    else await writer.query("DELETE FROM users.tenant_members WHERE tenant_id=$1 AND user_id=$2",[f.tenant,f.user]);
    const pending=f.post().then(value=>value);
    let waiting=false;
    for(let i=0;i<100;i++){
      waiting=Boolean((await handle.pool.query("SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND (query LIKE '%users.sessions%' OR query LIKE '%users.tenant_members%')")).rowCount);
      if(waiting)break;await new Promise(resolve=>setTimeout(resolve,10));
    }
    expect(waiting).toBe(true);await writer.query("COMMIT");expect((await pending).statusCode).toBe(kind==="revocation"?401:403);
  }finally{await writer.query("ROLLBACK");writer.release();}
});

it("serializes competing acceptance requests to a single immutable decision",async()=>{
  const f=await owner(),plans=await solved(f);
  const responses=await Promise.all([f.post(`/${plans[0]!.version}/accept`),f.post(`/${plans[1]!.version}/accept`)]);
  expect(responses.map(response=>response.statusCode).sort()).toEqual([200,409]);
  expect((await handle.pool.query("SELECT 1 FROM builds.plans WHERE build_id=$1 AND accepted_at IS NOT NULL",[f.build])).rowCount).toBe(1);
});
it("does not accept corrupted immutable evidence or advertise unversioned legacy rows",async()=>{
  const f=await owner(),plans=await solved(f);
  await handle.pool.query("UPDATE builds.plans SET metadata=jsonb_set(metadata,'{evidence,profile,evidence}','\"altered evidence\"') WHERE build_id=$1 AND version=$2",[f.build,plans[0]!.version]);
  expect((await f.post(`/${plans[0]!.version}/accept`)).statusCode).toBe(409);
  await handle.pool.query("UPDATE builds.plans SET metadata=NULL WHERE build_id=$1",[f.build]);
  const response=await app.inject({url:`/v1/builds/${f.build}/plans`,headers:f.headers});
  expect(response.statusCode).toBe(200);expect(response.json().plans).toEqual([]);
});
