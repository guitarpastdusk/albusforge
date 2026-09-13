/** No network: exercise the CLI against the real Ask renderer and gateway route. */
import Fastify from 'fastify';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Pool } from 'pg';
import { buildApp } from '../../ask/src/app';
import { registerSensorAsk, httpSensorAskClient } from '../../gateway/src/sensor-ask';
import { HttpError } from '../../gateway/src/http';
const [mode,file]=process.argv.slice(2);
const f=JSON.parse(await readFile(file!,'utf8'));
const events:string[]=[];
const ask=buildApp({concurrency:mode==='busy'?0:1,deadlineMs:1000,ping:async()=>{},maxTokens:128,write:line=>events.push(line),store:{
  reserve:async()=>{},started:async()=>{},finish:async()=>{},evidence:async q=>({from:q.from,to:q.to,unit:'°C',count:2,min:10,max:20,mean:15,latest:{t:new Date((f.ts-60)*1000).toISOString(),v:20}}),
}});
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const pool={connect:async()=>({release:()=>{},query:async(sql:string,args:unknown[]=[])=>{
  if(sql.startsWith('WITH RECURSIVE'))return{rows:args[0]===hash(f.session)?[{user_id:f.actor,active_tenant_id:f.tenant}]:args[0]===hash(f.otherSession)?[{user_id:f.otherActor,active_tenant_id:f.otherTenant}]:[]};
  if(sql.startsWith('SELECT id FROM users.tenants'))return{rows:[{id:args[1]}]};
  if(sql.includes('FROM users.tenant_members'))return{rows:[{}],rowCount:1};
  if(sql.includes('FROM telemetry.devices'))return{rows:[],rowCount:args[0]===f.device&&args[1]===f.tenant?1:0};
  return{rows:[],rowCount:0};
}})} as unknown as Pool;
const gateway=Fastify({genReqId:()=>randomUUID()});
gateway.addHook('onRequest',async(req,reply)=>{reply.header('x-request-id',req.id);});
gateway.setErrorHandler((error,_req,reply)=>{if(error instanceof HttpError)return reply.code(error.statusCode).send({error:{code:error.code,message:error.message}});throw error;});
registerSensorAsk(gateway,pool,httpSensorAskClient('http://ask.local',async()=>undefined,async(_url,init)=>{
  const response=await ask.inject({method:'POST',url:'/v1/ask',payload:String(init?.body),headers:{'content-type':'application/json'}});
  return new Response(response.body,{status:response.statusCode});
}));
let calls=0;
globalThis.fetch=async(url,init)=>{
  calls++;
  const u=new URL(String(url));
  const response=await gateway.inject({method:'POST',url:u.pathname,headers:init?.headers as Record<string,string>,payload:String(init?.body)});
  return new Response(response.body,{status:response.statusCode,headers:{'x-request-id':String(response.headers['x-request-id'])}});
};
try {
  process.argv=['node','acceptance.ts',mode==='busy'?'quota-check':'ask',file!,'staging'];
  await import('../scripts/acceptance');
  if(calls!==(mode==='busy'?1:3))throw new Error('Unexpected request count');
  if(mode==='busy'&&events.length)throw new Error('Admission falsely emitted durable quota evidence');
} finally {await gateway.close();await ask.close();}
