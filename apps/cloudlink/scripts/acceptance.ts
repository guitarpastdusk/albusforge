/** Deliberately separate from localhost-only development provisioning. */
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { open, readFile, stat } from 'node:fs/promises';
import { createDb, dbConfigFromEnv } from '@albusforge/db';
import { SESSION_COOKIE } from '@albusforge/schema';
import { z } from 'zod';

const Fixture = z.strictObject({ environment: z.enum(['staging','prod']), origin: z.enum(['https://staging.albusforge.ai','https://albusforge.ai']), run: z.uuid(), tenant: z.uuid(), otherTenant: z.uuid(), actor: z.uuid(), otherActor: z.uuid(), device: z.uuid(), token: z.string().regex(/^[\w-]{43}$/), session: z.string().regex(/^[\w-]{43}$/), otherSession: z.string().regex(/^[\w-]{43}$/), ts: z.number().int() });
const [phase, file, environment] = process.argv.slice(2);
if (!file || !['provision','ingest','verify','ask','audit','cleanup'].includes(phase ?? '')) throw new Error('Usage: acceptance.ts provision|ingest|verify|ask|audit|cleanup /private/path/fixture.json staging|prod');
if (!['staging','prod'].includes(environment ?? '')) throw new Error('Explicit staging or prod is required');
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
async function database<T>(work: (client: import('pg').PoolClient) => Promise<T>): Promise<T> {
  if (process.env.ACCEPTANCE_SQL_EXPORT) {
    if (!['provision','cleanup'].includes(phase!)) throw new Error('SQL export only supports provision/cleanup');
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
  const f = Fixture.parse({ environment, origin: environment === 'staging' ? 'https://staging.albusforge.ai' : 'https://albusforge.ai', run: randomUUID(), tenant: randomUUID(), otherTenant: randomUUID(), actor: randomUUID(), otherActor: randomUUID(), device: randomUUID(), token: secret(), session: secret(), otherSession: secret(), ts: Math.floor(Date.now()/60000)*60 });
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
  async function request(path: string, expected: number, body?: unknown, auth = f.session, deviceAuth = false) {
    const r = await fetch(new URL(path,f.origin),{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(auth ? deviceAuth?{authorization:`Bearer ${auth}`}:{cookie:`${SESSION_COOKIE}=${auth}`} : {})},body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(40000)});
    if (r.status!==expected) { await r.body?.cancel(); throw new Error(`HTTP status mismatch: expected ${expected}, received ${r.status}`); }
    const reader=r.body?.getReader(); if (!reader) return null;
    const chunks: Uint8Array[]=[]; let size=0;
    try { for (;;) { const {done,value}=await reader.read(); if(done) break; size+=value.length; if(size>65536) throw new Error('Oversized response'); chunks.push(value); } } finally { await reader.cancel().catch(()=>{}); }
    const text=Buffer.concat(chunks).toString('utf8'); return text?JSON.parse(text):null;
  }
  const from = new Date((f.ts-180)*1000).toISOString(), to = new Date(f.ts*1000).toISOString();
  const series = `/v1/telemetry/devices/${f.device}/series?${new URLSearchParams({channel:'temperature_c',from,to,resolution:'raw'})}`;
  if (phase==='ingest') {
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
    const result = await request(path,200,body); if (!result.message?.text?.includes('15') || !result.message.text.includes('2 readings')) throw new Error('Ask numerical evidence mismatch');
    // Print only correlation ID; inspect provider mode/usage through the scoped ledger audit.
    console.log(JSON.stringify({request_id:result.message.id}));
  } else await database(async c => {
    if (phase==='audit') {
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
  console.log(JSON.stringify({phase,run:f.run,status:process.env.ACCEPTANCE_SQL_EXPORT?'prepared_not_executed':'pass'}));
}
} catch { console.error(JSON.stringify({phase,status:'fail',message:'Acceptance failed; credentials and response bodies suppressed. Retain private manifest for scoped cleanup.'})); process.exitCode=1; }
