import { request } from "node:http";
import type { Socket } from "node:net";
import { buildApp } from "./app";
import { randomUUID } from "node:crypto";
import { createDb,type DbConfig } from "@albusforge/db";
import { runMigrations } from "@albusforge/db/migrate";
import { PostgreSqlContainer,type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { afterAll,beforeAll,expect,it,vi } from "vitest";
import { createStore } from "./store";
let container:StartedPostgreSqlContainer;
let handle:ReturnType<typeof createDb>;
let owner:pg.Pool;
beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  const admin = new pg.Client({ connectionString: container.getConnectionUri() });
  await admin.connect();
  await admin.query("CREATE ROLE albus_migrate LOGIN CREATEROLE PASSWORD 'migrate-secret'");
  await admin.query("CREATE DATABASE albus OWNER albus_migrate");
  await admin.end();
  const config: DbConfig = { host: container.getHost(), port: container.getPort(), database: "albus", user: "albus_migrate", password: "migrate-secret", ssl: "disable" };
  await runMigrations(config, { appRole: { name: "albus_app", password: "app-secret" } });
  owner = createDb(config).pool;
  handle = createDb({ ...config, user: "albus_app", password: "app-secret" }, { max: 5, connectTimeoutMs: 1000, statementTimeoutMs: 2000, queryTimeoutMs: 3000 });

});
afterAll(async () => { await handle?.pool.end(); await owner?.end(); await container?.stop(); });
async function fixture() {
  const tenant_id=randomUUID(),actor_id=randomUUID(),device_id=randomUUID();
  await handle.pool.query("INSERT INTO users.tenants(id,name) VALUES($1,'test')",[tenant_id]);
  await handle.pool.query("INSERT INTO users.users(id,email) VALUES($1,$2)",[actor_id,`${actor_id}@example.test`]);
  await handle.pool.query("INSERT INTO users.tenant_members(tenant_id,user_id,role) VALUES($1,$2,'viewer')",[tenant_id,actor_id]);
  await handle.pool.query(`INSERT INTO telemetry.devices(id,tenant_id,token_hash,channels,source)
    VALUES($1,$2,$3,'{"temperature":{"unit":"C","min":-40,"max":85}}','{}')`,[device_id,tenant_id,randomUUID()]);
  const from=new Date(Math.floor(Date.now()/3600000)*3600000-3600000).toISOString();
  const to=new Date(Date.parse(from)+3600000).toISOString();
  const q={tenant_id,actor_id,device_id,request_id:randomUUID(),question:"maximum?",channel:"temperature",from,to};
  const insert=async (seq:number,offset:number,value:number)=>handle.pool.query(`INSERT INTO telemetry.readings(device_id,seq,ordinal,channel,ts,value)
    VALUES($1,$2,0,'temperature',$3,$4)`,[device_id,seq,new Date(Date.parse(from)+offset*1000),value]);
  return {q,insert};
}
const store=()=>createStore(handle.pool,{user:100,tenant:100,global:1000});
it("reads half-open evidence, zero, ordering and sample statistics",async()=>{
  const {q,insert}=await fixture();await insert(3,20,6);await insert(1,0,0);await insert(2,10,3);await insert(4,3600,80);
  expect(await store().evidence(q)).toEqual({from:q.from,to:q.to,unit:"C",count:3,min:0,max:6,mean:3,latest:{t:new Date(Date.parse(q.from)+20000).toISOString(),v:6}});
});
it("rechecks membership and device ownership on reads and reservations",async()=>{
  const a=await fixture(),b=await fixture();
  for (const q of [{...a.q,device_id:b.q.device_id},{...a.q,actor_id:b.q.actor_id}]) {
    await expect(store().evidence(q)).rejects.toMatchObject({status:404});
    await expect(store().reserve(q)).rejects.toMatchObject({status:404});
  }
  await handle.pool.query("DELETE FROM users.tenant_members WHERE user_id=$1",[a.q.actor_id]);
  await expect(store().reserve(a.q)).rejects.toMatchObject({status:404});
});
it("rejects expired history, absent channels and excess points without partial summaries",async()=>{
  const {q}=await fixture();
  await expect(store().evidence({...q,channel:"missing"})).rejects.toMatchObject({status:404});
  await owner.query("UPDATE telemetry.retention_state SET raw_before=$1 WHERE id=1",[q.to]);
  try {await expect(store().evidence(q)).rejects.toMatchObject({status:410});}
  finally {await owner.query("UPDATE telemetry.retention_state SET raw_before='1970-01-01' WHERE id=1");}
  await handle.pool.query(`INSERT INTO telemetry.readings(device_id,seq,ordinal,channel,ts,value)
    SELECT $1,n,0,'temperature',$2::timestamptz,1 FROM generate_series(1,10001) n`,[q.device_id,q.from]);
  await expect(store().evidence(q)).rejects.toMatchObject({status:422});
});
it("reserves atomically across instances and prevents replay",async()=>{
  const {q}=await fixture();const limited=createStore(handle.pool,{user:1,tenant:100,global:1000});
  const results=await Promise.allSettled([limited.reserve(q),limited.reserve({...q,request_id:randomUUID()})]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  const accepted=(await handle.pool.query("SELECT request_id FROM telemetry.sensor_ask_requests WHERE actor_id=$1",[q.actor_id])).rows[0].request_id;
  await expect(limited.reserve({...q,request_id:accepted})).rejects.toMatchObject({status:409});
});
it("enforces global quota across tenants",async()=>{
  const before=(await handle.pool.query("SELECT count(*)::int AS n FROM telemetry.sensor_ask_requests")).rows[0].n;
  const a=await fixture(),b=await fixture();const limited=createStore(handle.pool,{user:100,tenant:100,global:before+1});
  const results=await Promise.allSettled([limited.reserve(a.q),limited.reserve(b.q)]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect(results.find(r=>r.status==='rejected')).toMatchObject({reason:{status:429}});
});
it("persists sensor attribution without prompt/build and releases transactions",async()=>{
  const {q}=await fixture();await store().reserve(q);await store().finish(q,"evidence_only");
  const row=(await handle.pool.query("SELECT * FROM telemetry.sensor_ask_requests WHERE request_id=$1",[q.request_id])).rows[0];
  expect(row).toMatchObject({tenant_id:q.tenant_id,actor_id:q.actor_id,device_id:q.device_id,outcome:'evidence_only'});
  expect(JSON.stringify(row)).not.toContain(q.question);expect(row).not.toHaveProperty('build_id');
  expect((await owner.query("SELECT 1 FROM pg_stat_activity WHERE datname='albus' AND state='idle in transaction'")).rowCount).toBe(0);
});
it("destroys a cancelled blocked SQL connection and recovers the pool",async()=>{
  const {q}=await fixture();const blocker=await owner.connect();await blocker.query("BEGIN");await blocker.query("LOCK TABLE telemetry.readings IN ACCESS EXCLUSIVE MODE");
  const abort=new AbortController();const pending=store().evidence(q,abort.signal);const observed=pending.catch(e=>e);
  try {setTimeout(()=>abort.abort(),50);expect(await observed).toBeInstanceOf(Error);}
  finally {await blocker.query("ROLLBACK");blocker.release();}
  expect((await store().evidence(q)).count).toBe(0);
});
it("distinguishes unknown provider usage from a known no-call outcome",async()=>{
  const {q}=await fixture();await store().reserve(q);await store().started(q);await store().finish(q,"evidence_only");
  const uncertain=(await handle.pool.query("SELECT * FROM telemetry.sensor_ask_requests WHERE request_id=$1",[q.request_id])).rows[0];
  expect(uncertain).toMatchObject({model_attempted:true,usage_known:false,cost_usd:null,input_tokens:null,output_tokens:null});
  const skipped={...q,request_id:randomUUID()};await store().reserve(skipped);await store().finish(skipped,"evidence_only");
  const known=(await handle.pool.query("SELECT * FROM telemetry.sensor_ask_requests WHERE request_id=$1",[skipped.request_id])).rows[0];
  expect(known).toMatchObject({model_attempted:false,usage_known:true,cost_usd:'0.000000',input_tokens:0,output_tokens:0});
});
it("enforces tenant quota across different actors",async()=>{
  const a=await fixture(),b=await fixture();
  await handle.pool.query("INSERT INTO users.tenant_members(tenant_id,user_id,role) VALUES($1,$2,'viewer')",[a.q.tenant_id,b.q.actor_id]);
  const limited=createStore(handle.pool,{user:100,tenant:1,global:1000});await limited.reserve(a.q);
  await expect(limited.reserve({...a.q,actor_id:b.q.actor_id,request_id:randomUUID()})).rejects.toMatchObject({status:429});
});
it("persists actual model tokens and cost under the accepted sensor identity",async()=>{
  const {q}=await fixture();await store().reserve(q);await store().started(q);
  await store().finish(q,"model",{stage:"ask",model:"claude-haiku-4-5",costUsd:0.002,inputTokens:100,outputTokens:20,cacheReadInputTokens:0,cacheCreationInputTokens:0,
    stopReason:"end_turn",buildId:null,tenantId:q.tenant_id,anonOwnerHash:null,prefixHash:null});
  const row=(await handle.pool.query("SELECT * FROM telemetry.sensor_ask_requests WHERE request_id=$1",[q.request_id])).rows[0];
  expect(row).toMatchObject({model_attempted:true,usage_known:true,outcome:'model',cost_usd:'0.002000',input_tokens:100,output_tokens:20,tenant_id:q.tenant_id});
});
function realApp(pool: pg.Pool) {
  return buildApp({store:createStore(pool,{user:100,tenant:100,global:1000}),maxTokens:512,concurrency:1,deadlineMs:10000,write:()=>{},ping:async()=>{}});
}
it("returns 503 on checked-out socket loss without uncaught errors and recovers on a fresh connection",async()=>{
  const {q}=await fixture();const pool=new pg.Pool({...handle.pool.options,password:"app-secret",max:1});const app=realApp(pool);
  const blocker=await owner.connect();await blocker.query("BEGIN");await blocker.query("SELECT pg_advisory_xact_lock(1936028275,1)");
  let leased:pg.PoolClient|undefined;
  pool.on('acquire',(client)=>{leased=client;});pool.on('error',()=>{});
  const uncaught:unknown[]=[];const trap=(error:unknown)=>{uncaught.push(error);};process.on('uncaughtException',trap);
  try {
    const response=Promise.resolve(app.inject({method:'POST',url:'/v1/ask',payload:q}));
    await vi.waitFor(async()=>expect((await owner.query("SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=1936028275 AND objid=1 AND NOT granted")).rowCount).toBeGreaterThan(0),{timeout:5000});
    (leased as pg.PoolClient & {connection:{stream:Socket}}).connection.stream.destroy();
    const failed=await response;expect(failed.statusCode).toBe(503);expect(failed.body).not.toContain('Connection terminated');expect(uncaught).toEqual([]);
    await blocker.query("ROLLBACK");
    const recovered=await app.inject({method:'POST',url:'/v1/ask',payload:{...q,request_id:randomUUID()}});expect(recovered.statusCode).toBe(200);
    expect(uncaught).toEqual([]);
  } finally {process.off('uncaughtException',trap);await blocker.query("ROLLBACK");blocker.release();await app.close();await pool.end();}
});
it("bounds waiting for a held pool slot by the shared deadline and destroys a late checkout once",async()=>{
  const {q}=await fixture();const pool=new pg.Pool({...handle.pool.options,password:"app-secret",max:1,connectionTimeoutMillis:3000});const held=await pool.connect();
  let late:pg.PoolClient|undefined;let releaseSpy:ReturnType<typeof vi.spyOn>|undefined;let querySpy:ReturnType<typeof vi.spyOn>|undefined;
  const observedPool=new Proxy(pool,{get(target,key) {
    if(key==='connect') return async()=>{const client=await target.connect();late=client;releaseSpy=vi.spyOn(client,'release');querySpy=vi.spyOn(client,'query');return client;};
    return Reflect.get(target,key);
  }});
  const controller=new AbortController();const pending=createStore(observedPool,{user:100,tenant:100,global:1000}).evidence(q,controller.signal);
  const outcome=pending.catch(error=>error);
  try {
    await vi.waitFor(()=>expect(pool.waitingCount).toBe(1));const before=performance.now();controller.abort();
    const result=await outcome;expect(result).toMatchObject({status:503});expect(performance.now()-before).toBeLessThan(500);
    held.release();await vi.waitFor(()=>expect(late).toBeDefined());await vi.waitFor(()=>expect(pool.totalCount).toBe(0));
    expect(releaseSpy).toHaveBeenCalledExactlyOnceWith(true);expect(querySpy).not.toHaveBeenCalled();
    expect((await createStore(pool,{user:100,tenant:100,global:1000}).evidence(q)).count).toBe(0);
  } finally {if(!late)held.release();await pool.end();}
});
it("cancels post-body disconnect during blocked SQL and promptly restores HTTP capacity",async()=>{
  const {q}=await fixture();const pool=new pg.Pool({...handle.pool.options,password:"app-secret",max:1});const app=realApp(pool);
  const blocker=await owner.connect();await blocker.query("BEGIN");await blocker.query("SELECT pg_advisory_xact_lock(1936028275,1)");
  await app.listen({host:'127.0.0.1',port:0});
  const caller=request(app.listeningOrigin+'/v1/ask',{method:'POST',headers:{'content-type':'application/json'}});caller.on('error',()=>{});
  try {
    caller.end(JSON.stringify(q));await vi.waitFor(async()=>expect((await owner.query("SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=1936028275 AND objid=1 AND NOT granted")).rowCount).toBeGreaterThan(0),{timeout:5000});
    caller.destroy();await vi.waitFor(()=>expect(pool.totalCount).toBe(0));
    await blocker.query('ROLLBACK');
    const next=await app.inject({method:'POST',url:'/v1/ask',payload:{...q,request_id:randomUUID()}});expect(next.statusCode).toBe(200);
  } finally {caller.destroy();await blocker.query('ROLLBACK');blocker.release();await app.close();await pool.end();}
});
