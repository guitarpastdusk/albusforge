import { mkdtemp, readFile, rm, stat, symlink, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { DeviceConfigV2, serializeFirmwareManifest, type FirmwareManifest } from '@albusforge/schema';
import { BENCH_PROFILE, benchManifest, prepareBench, readJournal, sha256, cleanupBenchSql, markBench } from './staging-bench.js';
import { executeBenchSql, verifyBenchJob, type CloudRequest, JOB, benchRunner } from './staging-bench-job.js';
export const image = `us-central1-docker.pkg.dev/albusforge-ci/albusforge/db-jobs@sha256:${'a'.repeat(64)}`;
export const manifestBytes = Buffer.from(serializeFirmwareManifest({ v: 1, build_id: '00000000-0000-4000-8000-000000000000', plan_version: 1, code_version: 1, profile_id: BENCH_PROFILE, runtime: '0.2.0', channels: {}, capabilities: [{ id: 'camera', kind: 'image', schema: 'jpeg.v1', profile_id: BENCH_PROFILE, profile_version: 1, enabled: true, required: true, interval_s: 900, max_bytes: 1048576, max_width: 320, max_height: 240 }], files: ['bootloader.bin','partition-table.bin','albusforge.bin'].map(path => ({path,sha256:'b'.repeat(64),size:100})), flash: {chip:'esp32s3',config_offset:36864,config_size:24576} } as FirmwareManifest));
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d,{recursive:true,force:true}))); });
async function directory() { const path = await mkdtemp(join(tmpdir(),'camera-bench-test-')); dirs.push(path); return path; }
it('writes exact bound V2 config and a nonsecret cleanup journal privately before SQL', async () => {
  const parent = await directory(), output = join(parent,'private');
  const f = await prepareBench(output, process.cwd(), manifestBytes, sha256(manifestBytes), image);
  const config = DeviceConfigV2.parse(JSON.parse(await readFile(join(output,'device-config.json'),'utf8')));
  expect(config.manifest_digest).toBe(sha256(manifestBytes)); expect(config.capabilities[0]?.interval_s).toBe(900);
  expect(config.observation_url).toBe(`https://staging.albusforge.ai/ingest/v2/devices/${f.journal.device}/observations`);
  expect(f.sql).toContain(sha256(config.token)); expect(f.sql).not.toContain(config.token);
  expect(await readFile(join(output,'cleanup.json'),'utf8')).not.toContain(config.token);
  expect((await stat(output)).mode & 0o777).toBe(0o700);
  for (const file of ['cleanup.json','device-config.json']) expect((await stat(join(output,file))).mode & 0o777).toBe(0o600);
  expect(await readJournal(output)).toEqual(f.journal);
  await expect(prepareBench(output, process.cwd(), manifestBytes, sha256(manifestBytes), image)).rejects.toThrow();
  expect(cleanupBenchSql(f.journal)).not.toContain(config.token);
});
it('rejects digest/capability changes, repository output and symlink targets', async () => {
  expect(() => benchManifest(manifestBytes,'0'.repeat(64))).toThrow();
  const changed = Buffer.from(manifestBytes.toString().replace('"interval_s":900','"interval_s":60'));
  expect(() => benchManifest(changed,sha256(changed))).toThrow();
  await expect(prepareBench(join(process.cwd(),'private-bench-test'),process.cwd(),manifestBytes,sha256(manifestBytes),image)).rejects.toThrow('outside');
  const parent = await directory(); await symlink(parent,join(parent,'link'));
  await expect(prepareBench(join(parent,'link'),process.cwd(),manifestBytes,sha256(manifestBytes),image)).rejects.toThrow();
});

function fixtures() {
 const env={DB_HOST:'10.20.0.2',DB_USER:'albus_app',DB_NAME:'albusforge',DB_SSL:'require'};
 const container={image,env:Object.entries(env).map(([name,value])=>({name,value}))};
 const job={name:JOB,etag:'reviewed-etag',template:{template:{serviceAccount:'registry-load-run@albusforge-staging.iam.gserviceaccount.com',containers:[container],vpcAccess:{networkInterfaces:[{network:'albusforge-staging',subnetwork:'albusforge-staging-us-central1'}]}}}};
 const calls: {url:string,body?:unknown}[]=[];
 const run:CloudRequest=async(url,body)=>{calls.push({url,body});return url.includes('sqladmin')?{name:'albusforge-staging-pg',connectionName:'albusforge-staging:us-central1:albusforge-staging-pg',ipAddresses:[{type:'PRIVATE',ipAddress:'10.20.0.2'}]}:body?{name:'operation',done:true,response:{succeededCount:1,conditions:[{type:'Completed',state:'CONDITION_SUCCEEDED'}]}}:job;};
 return {container,job,calls,run};
}
it('pins the verified etag in execution-only overrides',async()=>{
 const f=fixtures();await executeBenchSql('SELECT 1',image,f.run);
 expect(f.calls).toHaveLength(3);expect(f.calls.at(-1)?.body).toMatchObject({etag:'reviewed-etag',overrides:{taskCount:1}});
 expect(f.calls.at(-1)?.url).toBe(`https://run.googleapis.com/v2/${JOB}:run`);
});
it('rejects drift and ambiguous execution success',async()=>{
 const f=fixtures();f.container.image=image.replace('a'.repeat(64),'b'.repeat(64));
 await expect(verifyBenchJob(image,f.run)).rejects.toThrow();f.container.image=image;
 f.container.env.find(e=>e.name==='DB_USER')!.value='postgres';await expect(verifyBenchJob(image,f.run)).rejects.toThrow();
 f.container.env.find(e=>e.name==='DB_USER')!.value='albus_app';
 await expect(executeBenchSql('SELECT 1',image,async(url,body)=>body?{name:'op',done:true,response:{succeededCount:0,conditions:[]}}:f.run(url))).rejects.toThrow('unverified');
});
it('executes the emitted async Node runner and awaits its SQL query',async()=>{
 const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');
 const root=await directory();await mkdir(join(root,'packages/db/dist'),{recursive:true});
 await writeFile(join(root,'package.json'),'{"type":"module"}');
 await writeFile(join(root,'packages/db/dist/index.js'),`export const dbConfigFromEnv=()=>({host:'10.20.0.2',user:'albus_app',database:'albusforge',ssl:'require'});export const createDb=(c,o)=>{if(o.connectTimeoutMs!==5000)throw Error('timeout');return{pool:{query:async sql=>{if(sql!=='SELECT 1')throw Error('query')},end:async()=>{}}}};`);
 const result=await promisify(execFile)(process.execPath,['--input-type=module','-e',benchRunner('SELECT 1','10.20.0.2')],{cwd:root});
 expect(result.stdout).toBe('bench_sql_complete\n');expect(result.stderr).toBe('');
});

it('retains cleanup identity when readiness output fails after preparation',async()=>{
 const parent=await directory(),output=join(parent,'private');const prepared=await prepareBench(output,process.cwd(),manifestBytes,sha256(manifestBytes),image);
 await mkdir(join(output,'ready.json'));
 await expect(markBench(output,'ready')).rejects.toThrow();
 expect(await readJournal(output)).toEqual(prepared.journal);
 expect((await stat(join(output,'device-config.json'))).isFile()).toBe(true);
 expect((await stat(join(output,'ready.json'))).isFile()).toBe(false);
});
it('plan-only CLI rejects production and performs no fixture preparation',async()=>{
 const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');
 const {createRequire}=await import('node:module');const require=createRequire(import.meta.url);
 const cli=join(process.cwd(),'src/staging-bench-cli.ts');
 const result=await promisify(execFile)(process.execPath,['--import',require.resolve('tsx'),'--',cli,'--project','albusforge-staging','--origin','https://staging.albusforge.ai']);
 expect(JSON.parse(result.stdout).mode).toBe('plan-only');
 await expect(promisify(execFile)(process.execPath,['--import',require.resolve('tsx'),'--',cli,'--project','albusforge-prod','--origin','https://albusforge.ai'])).rejects.toThrow();
});
it('a newly approved executor digest can verify after deployment while old digest fails closed',async()=>{
 const f=fixtures(),newImage=image.replace('a'.repeat(64),'c'.repeat(64));f.container.image=newImage;
 await expect(verifyBenchJob(image,f.run)).rejects.toThrow();
 await expect(verifyBenchJob(newImage,f.run)).resolves.toMatchObject({etag:'reviewed-etag'});
});
