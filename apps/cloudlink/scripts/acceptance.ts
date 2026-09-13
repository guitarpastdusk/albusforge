/** Deliberately separate from localhost-only development provisioning. */
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { open, readFile, stat } from 'node:fs/promises';
import { createDb, dbConfigFromEnv } from '@albusforge/db';
import { SESSION_COOKIE } from '@albusforge/schema';
import { z } from 'zod';

const Fixture = z.strictObject({ purpose: z.enum(['pipeline','quota']).default('pipeline'), environment: z.enum(['staging','prod']), origin: z.enum(['https://staging.albusforge.ai','https://albusforge.ai']), run: z.uuid(), tenant: z.uuid(), otherTenant: z.uuid(), actor: z.uuid(), otherActor: z.uuid(), device: z.uuid(), token: z.string().regex(/^[\w-]{43}$/), session: z.string().regex(/^[\w-]{43}$/), otherSession: z.string().regex(/^[\w-]{43}$/), ts: z.number().int() });
const [phase, file, environment] = process.argv.slice(2);
if (!file || !['provision','ingest','verify','ask','audit','cleanup','quota-seed','quota-check','quota-confirm','quota-audit','load','verify-cleanup'].includes(phase ?? '')) throw new Error('Usage: acceptance.ts provision|ingest|verify|ask|audit|cleanup|quota-seed|quota-check|quota-confirm|quota-audit|load|verify-cleanup /private/path/fixture.json staging|prod');
if (!['staging','prod'].includes(environment ?? '')) throw new Error('Explicit staging or prod is required');
if (process.env.ACCEPTANCE_SQL_EXPORT && !['provision','cleanup','quota-seed','quota-audit'].includes(phase!)) throw new Error('SQL export cannot be combined with HTTP or audit phases');
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
async function database<T>(work: (client: import('pg').PoolClient) => Promise<T>): Promise<T> {
  if (process.env.ACCEPTANCE_SQL_EXPORT) {
    if (!['provision','cleanup','quota-seed','quota-audit'].includes(phase!)) throw new Error('SQL export only supports fixture mutations and quota audit');
    const statements: { text: string; values: unknown[] }[] = [];
    const result = await work({ query: async (text: string, values: unknown[] = []) => { statements.push({text,values}); return {rows:[],rowCount:0}; } } as unknown as import('pg').PoolClient);
    const handle = await open(process.env.ACCEPTANCE_SQL_EXPORT,'wx',0o600);
    try { await handle.writeFile(JSON.stringify({environment,statements})); await handle.sync(); } finally { await handle.close(); }
    return result;
  }
  const config = dbConfigFromEnv();
  if (!['localhost','127.0.0.1','::1'].includes(config.host) || process.env.K_SERVICE) throw new Error('Use an explicitly targeted local Cloud SQL proxy');
  const { pool } = createDb(config, { max: 1, connectTimeoutMs: 5000, statementTimeoutMs: 10000, queryTimeoutMs: 11000 });
  try { const client = await pool.connect(); try { return await work(client); } finally { client.release(true); } } finally { await pool.end(); }
}
try {
if (phase === 'provision') {
  const f = Fixture.parse({ purpose:process.env.ACCEPTANCE_PURPOSE??'pipeline', environment, origin: environment === 'staging' ? 'https://staging.albusforge.ai' : 'https://albusforge.ai', run: randomUUID(), tenant: randomUUID(), otherTenant: randomUUID(), actor: randomUUID(), otherActor: randomUUID(), device: randomUUID(), token: secret(), session: secret(), otherSession: secret(), ts: Math.floor(Date.now()/60000)*60 });
  if(f.purpose==='quota' && f.environment!=='staging') throw new Error('Quota fixture is staging only');
  // Persist first so even an uncertain COMMIT can be recovered/revoked using this manifest.
  const handle = await open(file,'wx',0o600); try { await handle.writeFile(JSON.stringify(f)); await handle.sync(); } finally { await handle.close(); }
  await database(async c => { await c.query('BEGIN'); try {
    for (const [tenant,actor,session] of [[f.tenant,f.actor,f.session],[f.otherTenant,f.otherActor,f.otherSession]]) {
      await c.query("INSERT INTO users.tenants(id,name) VALUES($1,$2)",[tenant,`Sensor acceptance ${f.run}`]);
      await c.query('INSERT INTO users.users(id,email) VALUES($1,$2)',[actor,`${actor}@acceptance.invalid`]);
      await c.query("INSERT INTO users.tenant_members(tenant_id,user_id,role) VALUES($1,$2,'viewer')",[tenant,actor]);
      await c.query("INSERT INTO users.sessions(token_hash,user_id,active_tenant_id,expires_at) VALUES($1,$2,$3,now()+interval '2 hours')",[hash(session!),actor,tenant]);
    }
    await c.query('INSERT INTO telemetry.devices(id,tenant_id,token_hash,channels,source) VALUES($1,$2,$3,$4,$5)',[f.device,f.tenant,hash(f.token),{temperature_c:{unit:'°C',min:-40,max:85}},{kind:'simulator',acceptance_run:f.run}]);
    await c.query('COMMIT');
  } catch { await c.query('ROLLBACK'); throw new Error('Fixture transaction failed; retain manifest for cleanup'); } });
  console.log(JSON.stringify({phase,run:f.run,status:process.env.ACCEPTANCE_SQL_EXPORT?'prepared_not_executed':'pass'}));
} else {
  const info = await stat(file); if ((info.mode & 0o077)!==0) throw new Error('Manifest must be private (0600)');
  const f = Fixture.parse(JSON.parse(await readFile(file,'utf8'))); if (f.environment !== environment || f.origin !== (environment==='staging'?'https://staging.albusforge.ai':'https://albusforge.ai')) throw new Error('Environment mismatch');
  const statusCounts:Record<string,number>={}; let requestId:string|undefined;
  async function request(path: string, expected: number | number[], body?: unknown, auth = f.session, deviceAuth = false) {
    const r = await fetch(new URL(path,f.origin),{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(auth ? deviceAuth?{authorization:`Bearer ${auth}`}:{cookie:`${SESSION_COOKIE}=${auth}`} : {})},body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(40000)});
    statusCounts[r.status]=(statusCounts[r.status]??0)+1; requestId=r.headers.get('x-request-id')??undefined;
    if (!(Array.isArray(expected)?expected:[expected]).includes(r.status)) { await r.body?.cancel(); throw new Error(`HTTP status mismatch: expected ${expected}, received ${r.status}`); }
    const reader=r.body?.getReader(); if (!reader) return null;
    const chunks: Uint8Array[]=[]; let size=0;
    try { for (;;) { const {done,value}=await reader.read(); if(done) break; size+=value.length; if(size>65536) throw new Error('Oversized response'); chunks.push(value); } } finally { await reader.cancel().catch(()=>{}); }
    const text=Buffer.concat(chunks).toString('utf8'); return text?JSON.parse(text):null;
  }
  if ((phase!.startsWith('quota-') && (f.environment!=='staging' || f.purpose!=='quota')) || (['ask','load','ingest','verify'].includes(phase!) && f.purpose!=='pipeline')) throw new Error('Wrong fixture purpose');
  const from = new Date((f.ts-180)*1000).toISOString(), to = new Date(f.ts*1000).toISOString();
  const series = `/v1/telemetry/devices/${f.device}/series?${new URLSearchParams({channel:'temperature_c',from,to,resolution:'raw'})}`;
  if (phase==='load') {
    if (f.environment!=='staging') throw new Error('Load is staging only');
    // Ten concurrent, thirty total; repeat accepted packets, never generate load on the model.
    for (let batch=0;batch<3;batch++) {
      const outcomes=await Promise.allSettled(Array.from({length:10},()=>request('/ingest/v1',[batch===1?401:202,429,503],{v:1,dev:f.device,seq:batch===2?2:1,ts:f.ts,r:[{c:'temperature_c',t:batch===2?-120:-60,v:batch===2?10:20}],st:{rssi:-62,up_s:60,health:['OK']}},batch===1?secret():f.token,true)));
      if (outcomes.some(r=>r.status==='rejected')) throw new Error('Unexpected load response');
    }
    if (!((statusCounts['202']??0)>0) || !((statusCounts['401']??0)>0)) throw new Error('No useful load evidence');
    console.log(JSON.stringify({concurrency:10,total:30,statusCounts}));
  } else if (phase==='verify-cleanup') {
    await request(series,401); await request(series,401,undefined,f.otherSession);
    await request('/ingest/v1',401,{v:1,dev:f.device,seq:1,ts:f.ts,r:[{c:'temperature_c',t:-60,v:20}],st:{rssi:-62,up_s:60,health:['OK']}},f.token,true);
  } else if (phase==='quota-confirm') {
    const record = z.strictObject({run:z.uuid(),environment:z.enum(['staging','prod']),request_id:z.uuid()}).parse(JSON.parse(await readFile(z.string().min(1).parse(process.env.ACCEPTANCE_QUOTA_REQUEST),'utf8')));
    if(record.run!==f.run || record.environment!==f.environment) throw new Error('Correlation mismatch');
    const entries=z.array(z.object({resource:z.object({type:z.literal('cloud_run_revision'),labels:z.object({project_id:z.string(),service_name:z.literal('ask')})}),jsonPayload:z.object({event:z.literal('sensor_ask_quota_rejected'),request_id:z.uuid(),scope:z.enum(['actor','tenant','global'])})})).parse(JSON.parse(await readFile(z.string().min(1).parse(process.env.ACCEPTANCE_QUOTA_PROOF),'utf8')));
    if(entries.length!==1 || entries[0]!.resource.labels.project_id!==`albusforge-${f.environment}` || entries[0]!.jsonPayload.request_id!==record.request_id || entries[0]!.jsonPayload.scope!=='actor') throw new Error('Durable actor quota remains unproven');
  } else if (phase==='quota-check') {
    const path=z.string().min(1).parse(process.env.ACCEPTANCE_QUOTA_REQUEST);
    // Reserve the artifact before sending; never overwrite a previous paid/request correlation.
    const handle=await open(path,'wx',0o600);
    try { await request(`/v1/devices/${f.device}/ask`,429,{text:'What is the average temperature?',channel:'temperature_c',from,to});
      await handle.writeFile(JSON.stringify({run:f.run,environment:f.environment,request_id:z.uuid().parse(requestId)})); await handle.sync();
    } finally { await handle.close(); }
    console.log(JSON.stringify({phase,run:f.run,request_id:requestId,status:'unproven_requires_durable_event'}));
    process.exitCode=2;
  } else if (phase==='ingest') {
    for (const [seq,t,v] of [[1,-60,20],[1,-60,20],[2,-120,10]]) await request('/ingest/v1',202,{v:1,dev:f.device,seq,ts:f.ts,r:[{c:'temperature_c',t,v}],st:{rssi:-62,up_s:60,health:['OK']}},f.token,true);
    await request('/ingest/v1',401,{v:1,dev:f.device,seq:3,ts:f.ts,r:[{c:'temperature_c',t:-60,v:99}],st:{rssi:-62,up_s:60,health:['OK']}},secret(),true);
  } else if (phase==='verify') {
    await request(series,401,undefined,''); await request(series,404,undefined,f.otherSession);
    const raw = await request(series,200); if (raw.points.length!==2 || raw.points[0].v!==10 || raw.points[1].v!==20) throw new Error('Raw dedup/backfill evidence mismatch');
    const latest = await request(`/v1/telemetry/devices/${f.device}/latest`,200); if (latest.readings[0]?.v!==20) throw new Error('Latest regressed');
    const rollup = await request(series.replace('resolution=raw','resolution=1m'),200); if (rollup.pending_rollup || rollup.points.reduce((n:number,p:{n:string})=>n+Number(p.n),0)!==2) throw new Error('Rollup pending or count mismatch');
  } else if (phase==='ask') {
    const path = `/v1/devices/${f.device}/ask`, body = {text:'What is the average temperature?',channel:'temperature_c',from,to};
    await request(path,401,body,''); await request(path,404,body,f.otherSession);
    const result = await request(path,200,body); if (! /sample mean 15\s+°C\./u.test(result.message?.text??'') || !result.message.text.includes('2 readings')) throw new Error('Ask numerical evidence mismatch');
    // Print only correlation ID; inspect provider mode/usage through the scoped ledger audit.
    console.log(JSON.stringify({request_id:result.message.id}));
  } else await database(async c => {
    if (phase==='quota-seed' || phase==='quota-audit') {
      const limit=z.coerce.number().int().min(1).max(20).parse(process.env.ACCEPTANCE_ACTOR_LIMIT);
      const tenantLimit=z.coerce.number().int().min(limit+1).max(100000).parse(process.env.ACCEPTANCE_TENANT_LIMIT);
      const globalLimit=z.coerce.number().int().min(tenantLimit+1).max(1000000).parse(process.env.ACCEPTANCE_GLOBAL_LIMIT);
      if (process.env.ACCEPTANCE_MODEL_DISABLED!=='verified') throw new Error('Coordinator must verify deployed model disabled');
      await c.query('BEGIN'); try {
        await c.query('SELECT pg_advisory_xact_lock(1936028275,1)');
        await c.query("SELECT 1/(CASE WHEN count(*)+$2<$3 AND count(*) FILTER(WHERE tenant_id=$1)+$2<$4 THEN 1 ELSE 0 END) FROM telemetry.sensor_ask_requests WHERE created_at>statement_timestamp()-interval '24 hours'",[f.tenant,phase==='quota-seed'?limit:0,globalLimit,tenantLimit]);
        if (phase==='quota-seed') {
          // Must be an unused isolated actor: no existing reservations or model activity.
          await c.query('SELECT 1/(CASE WHEN EXISTS(SELECT 1 FROM telemetry.sensor_ask_requests WHERE actor_id=$1) THEN 0 ELSE 1 END)',[f.actor]);
          for(let i=0;i<limit;i++) await c.query("INSERT INTO telemetry.sensor_ask_requests(request_id,tenant_id,actor_id,device_id,outcome,usage_known,input_tokens,output_tokens,cache_read_tokens,cache_creation_tokens,cost_usd) VALUES($1,$2,$3,$4,'failed',true,0,0,0,0,0)",[randomUUID(),f.tenant,f.actor,f.device]);
        } else {
          // Executed after the one denied HTTP call: no extra reservation/provider attempt permitted.
          await c.query('SELECT 1/(CASE WHEN count(*)=$4 AND count(*) FILTER(WHERE model_attempted OR NOT usage_known OR outcome<>\'failed\' OR cost_usd IS DISTINCT FROM 0 OR model IS NOT NULL OR input_tokens IS DISTINCT FROM 0 OR output_tokens IS DISTINCT FROM 0 OR cache_read_tokens IS DISTINCT FROM 0 OR cache_creation_tokens IS DISTINCT FROM 0 OR tenant_id<>$2 OR device_id<>$3)=0 THEN 1 ELSE 0 END) FROM telemetry.sensor_ask_requests WHERE actor_id=$1',[f.actor,f.tenant,f.device,limit]);
        }
        await c.query('COMMIT');
      } catch { await c.query('ROLLBACK'); throw new Error('Quota evidence mismatch'); }
    } else if (phase==='audit') {
      const rows = (await c.query('SELECT request_id,outcome,model,model_attempted,usage_known,input_tokens,output_tokens,cost_usd FROM telemetry.sensor_ask_requests WHERE tenant_id=$1 AND actor_id=$2 AND device_id=$3 ORDER BY created_at',[f.tenant,f.actor,f.device])).rows;
      console.log(JSON.stringify({usage:rows}));
    } else {
      await c.query('BEGIN'); try {
        await c.query('UPDATE users.sessions SET revoked_at=now() WHERE token_hash=ANY($1::text[]) AND user_id=ANY($2::uuid[])',[[hash(f.session),hash(f.otherSession)],[f.actor,f.otherActor]]);
        await c.query("UPDATE telemetry.devices SET revoked_at=now() WHERE id=$1 AND tenant_id=$2 AND source->>'acceptance_run'=$3",[f.device,f.tenant,f.run]);
        await c.query('COMMIT');
      } catch { await c.query('ROLLBACK'); throw new Error('Cleanup failed'); }
    }
  });
  if (phase!=='quota-check') console.log(JSON.stringify({phase,run:f.run,status:process.env.ACCEPTANCE_SQL_EXPORT?'prepared_not_executed':'pass'}));
}
} catch { console.error(JSON.stringify({phase,status:'fail',message:'Acceptance failed; credentials and response bodies suppressed. Retain private manifest for scoped cleanup.'})); process.exitCode=1; }
