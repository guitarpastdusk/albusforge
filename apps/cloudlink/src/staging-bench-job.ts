import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
const exec = promisify(execFile);
export type CloudRequest = (url: string, body?: unknown) => Promise<unknown>;
export const JOB = 'projects/albusforge-staging/locations/us-central1/jobs/registry-load';
const ROOT = 'https://run.googleapis.com/v2/';
export async function authenticatedCloud(): Promise<CloudRequest> {
  let token: string;
  try { token = (await exec('gcloud',['auth','print-access-token','--project=albusforge-staging'],{timeout:15000,maxBuffer:16384})).stdout.trim(); }
  catch { throw new Error('Bench cloud authentication failed'); }
  return async (url, body) => {
    if (!url.startsWith(ROOT+'projects/albusforge-staging/') && url !== 'https://sqladmin.googleapis.com/sql/v1beta4/projects/albusforge-staging/instances/albusforge-staging-pg') throw new Error('Bench invalid cloud endpoint');
    try {
      const response = await fetch(url,{method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(30000)});
      if (!response.ok) throw new Error('cloud request'); return await response.json();
    } catch { throw new Error('Bench cloud request failed; preserve journal for scoped cleanup'); }
  };
}
const Container = z.object({ name:z.string().optional(), image:z.string(), command:z.array(z.string()).optional(), env:z.array(z.object({name:z.string(),value:z.string().optional()})) });
const Job = z.object({ name:z.literal(JOB), etag:z.string().min(1), reconciling:z.boolean().optional(), template:z.object({template:z.object({serviceAccount:z.literal('registry-load-run@albusforge-staging.iam.gserviceaccount.com'),containers:z.array(Container).length(1),vpcAccess:z.object({networkInterfaces:z.array(z.object({network:z.string(),subnetwork:z.string()})).length(1)})})}) });
export async function verifyBenchJob(image:string, request:CloudRequest) {
  if (!/^us-central1-docker\.pkg\.dev\/albusforge-ci\/albusforge\/db-jobs@sha256:[a-f0-9]{64}$/.test(image)) throw new Error('Bench requires approved immutable db-jobs image');
  const instance=z.object({name:z.literal('albusforge-staging-pg'),connectionName:z.literal('albusforge-staging:us-central1:albusforge-staging-pg'),ipAddresses:z.array(z.object({type:z.string(),ipAddress:z.ipv4()}))}).parse(await request('https://sqladmin.googleapis.com/sql/v1beta4/projects/albusforge-staging/instances/albusforge-staging-pg'));
  const ip=instance.ipAddresses.find(x=>x.type==='PRIVATE')?.ipAddress;
  const job=Job.parse(await request(ROOT+JOB)); const task=job.template.template, container=task.containers[0]!, network=task.vpcAccess.networkInterfaces[0]!;
  const env=new Map(container.env.map(e=>[e.name,e.value]));
  const matches=(actual:string,name:string,kind:string)=>actual===name||actual===`projects/albusforge-staging/${kind}/${name}`;
  if(!ip||job.reconciling||container.image!==image||container.command?.length||new Set(container.env.map(e=>e.name)).size!==container.env.length||env.get('DB_HOST')!==ip||env.get('DB_USER')!=='albus_app'||env.get('DB_NAME')!=='albusforge'||env.get('DB_SSL')!=='require'||(env.has('DB_PORT')&&env.get('DB_PORT')!=='5432')||!matches(network.network,'albusforge-staging','global/networks')||!matches(network.subnetwork,'albusforge-staging-us-central1','regions/us-central1/subnetworks')) throw new Error('Bench staging job provenance mismatch');
  return {ip,etag:job.etag,container:container.name};
}
export function benchRunner(sql:string, ip:string) {
  const payload=Buffer.from(sql).toString('base64');
  const script=`(async()=>{const {createDb,dbConfigFromEnv}=await import('./packages/db/dist/index.js');const c=dbConfigFromEnv();if(c.host!==${JSON.stringify(ip)}||c.user!=='albus_app'||c.database!=='albusforge'||c.ssl!=='require')throw Error('bench guard');const {pool}=createDb(c,{max:1,connectTimeoutMs:5000,statementTimeoutMs:30000,queryTimeoutMs:35000});try{await pool.query(Buffer.from('${payload}','base64').toString());console.log('bench_sql_complete')}catch{process.exitCode=1;console.error('bench_sql_failed')}finally{await pool.end()}})().catch(()=>{console.error('bench_sql_failed');process.exitCode=1})`;
  return `await eval(Buffer.from('${Buffer.from(script).toString('base64')}','base64').toString())`;
}
export async function executeBenchSql(sql:string,image:string,request:CloudRequest) {
  const verified=await verifyBenchJob(image,request);
  let operation=z.object({name:z.string(),done:z.boolean().optional(),error:z.unknown().optional(),response:z.unknown().optional()}).parse(await request(ROOT+JOB+':run',{etag:verified.etag,overrides:{taskCount:1,timeout:'120s',containerOverrides:[{...(verified.container?{name:verified.container}:{}),args:['node','--input-type=module','-e',benchRunner(sql,verified.ip)]}]}}));
  const deadline=Date.now()+600000;
  while(!operation.done) {
    if(!/^projects\/albusforge-staging\/locations\/us-central1\/operations\/[A-Za-z0-9_-]+$/.test(operation.name)||Date.now()>deadline) throw new Error('Bench execution unverified; preserve journal');
    await delay(1000); operation=z.object({name:z.string(),done:z.boolean().optional(),error:z.unknown().optional(),response:z.unknown().optional()}).parse(await request(ROOT+operation.name));
  }
  if(operation.error)throw new Error('Bench execution failed; preserve journal');
  const execution=z.object({succeededCount:z.number(),failedCount:z.number().optional(),conditions:z.array(z.object({type:z.string(),state:z.string()}))}).parse(operation.response);
  if(execution.succeededCount!==1||(execution.failedCount??0)!==0||!execution.conditions.some(c=>c.type==='Completed'&&c.state==='CONDITION_SUCCEEDED'))throw new Error('Bench execution success unverified; preserve journal');
}
