import { constants } from 'node:fs';
import { open, unlink, realpath, stat } from 'node:fs/promises';
import { isAbsolute, dirname, basename, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { GcsObservationStorage } from '@albusforge/storage';
import { runStagingIngestWithDatabase, stagingOrigin, type AcceptanceFixture } from './staging-acceptance.js';
import { jobAcceptanceDatabase, acceptanceCleanupSql } from './staging-acceptance-job.js';
import { authenticatedCloud, executeBenchSql } from './staging-bench-job.js';

const Journal = z.object({
  version: z.literal(1), project: z.literal('albusforge-staging'), bucket: z.literal('albusforge-staging-observations'),
  fixture: z.object({ tenant: z.uuid(), device: z.uuid(), observation: z.uuid(), key: z.string(), tokenHash: z.string().regex(/^[a-f0-9]{64}$/), source: z.object({kind:z.literal('staging-acceptance'),run:z.uuid()}).strict() }).strict(),
}).strict();
async function main() {
  const args=process.argv.slice(2), values=new Map<string,string>(); let execute=false;
  const allowed=new Set(['--project','--origin','--bucket','--job-image','--journal','--cleanup-journal']);
  for(let i=0;i<args.length;i++) {
    const key=args[i]!;
    if(key==='--execute') { if(execute)throw Error('Acceptance duplicate argument'); execute=true; continue; }
    if(!allowed.has(key)||values.has(key)||!args[i+1]||args[i+1]!.startsWith('--'))throw Error('Acceptance invalid arguments');
    values.set(key,args[++i]!);
  }
  if(values.get('--project')!=='albusforge-staging'||values.get('--bucket')!=='albusforge-staging-observations'||!values.has('--origin'))throw Error('Acceptance requires explicit staging project, bucket and origin');
  const origin=stagingOrigin(values.get('--origin')!);
  const cleanup=values.get('--cleanup-journal'), journal=values.get('--journal');
  if(cleanup&&journal)throw Error('Acceptance choose one journal action');
  if(!execute) { console.log(JSON.stringify({mode:'plan-only',transport:'staging-registry-load',origin,action:cleanup?'Fence and clean only the journal fixture; retain tombstone for uncertain executions':'Post synthetic JPEG and numeric readings locally; verify SQL via guarded restricted staging job, GCS via maintenance identity; retain private recovery journal'})); return; }
  const image=values.get('--job-image');
  if(!image||!/^us-central1-docker\.pkg\.dev\/albusforge-ci\/albusforge\/db-jobs@sha256:[a-f0-9]{64}$/.test(image))throw Error('Acceptance requires explicitly approved immutable --job-image for this run or recovery');
  let path=cleanup??journal;
  if(!path||!isAbsolute(path))throw Error('Acceptance requires absolute --journal or --cleanup-journal');
  const directory=await realpath(dirname(path));
  const dirStat=await stat(directory);
  if(!dirStat.isDirectory()||(dirStat.mode&0o077)!==0||dirStat.uid!==process.getuid?.())throw Error('Acceptance journal parent must be owned and private');
  let inRepository=false;
  try {await promisify(execFile)('git',['-C',directory,'rev-parse','--is-inside-work-tree'],{timeout:5000,maxBuffer:1024});inRepository=true;} catch(error) {if((error as {code?:number}).code!==128)throw Error('Acceptance cannot verify journal location');}
  if(inRepository)throw Error('Acceptance journal must be outside a Git repository');
  path=join(directory,basename(path));
  const request=await authenticatedCloud();
  const sql=(statement:string)=>executeBenchSql(statement,image,request);
  if(cleanup) {
    const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    let state:z.infer<typeof Journal>;
    try { const stat=await file.stat(); if(!stat.isFile()||(stat.mode&0o077)!==0||stat.size>8192)throw Error('Acceptance journal must be a private regular file'); state=Journal.parse(JSON.parse(await file.readFile('utf8'))); } finally {await file.close();}
    await sql(acceptanceCleanupSql(state.fixture,false));
    console.log(JSON.stringify({status:'cleanup-queued',tenant:state.fixture.tenant,device:state.fixture.device,journal:path,retainedTenantFence:true}));
    return;
  }
  const store=new GcsObservationStorage({bucket:'albusforge-staging-observations',timeoutMs:20000,maxWorkers:1,impersonateServiceAccount:'observation-maintain-run@albusforge-staging.iam.gserviceaccount.com',workerPath:process.env.OBSERVATION_STORAGE_WORKER_PATH});
  const persist=async(fixture:AcceptanceFixture)=>{
    const file=await open(path,'wx',0o600);
    try {await file.writeFile(JSON.stringify(Journal.parse({version:1,project:'albusforge-staging',bucket:'albusforge-staging-observations',fixture})));await file.sync();} finally {await file.close();}
    const parent=await open(directory,constants.O_RDONLY);try{await parent.sync();}finally{await parent.close();}
  };
  const result=await runStagingIngestWithDatabase(jobAcceptanceDatabase(sql,store,persist),store,origin);
  await unlink(path);
  console.log(JSON.stringify(result));
}
main().catch(()=>{console.error(JSON.stringify({status:'failed',message:'Acceptance job transport failed. Retain private journal; retry scoped cleanup with an explicitly approved current job image. No credentials or child output are printed.'}));process.exitCode=1;});
