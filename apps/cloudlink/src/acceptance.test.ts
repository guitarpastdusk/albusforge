import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';

// Avoid paying package-manager startup for every isolated CLI assertion. Keep
// a hard per-child timeout as well as a bounded suite budget under CI contention.
const loader=createRequire(import.meta.url).resolve('tsx');
const runCli=(args:string[],env:NodeJS.ProcessEnv)=>spawnSync(process.execPath,['--import',loader,...args],{encoding:'utf8',env,timeout:20_000,killSignal:'SIGKILL',maxBuffer:1024*1024});

describe('deployment acceptance preparation', () => {
  it('exports only hashes for remote SQL and scopes cleanup without deleting accounting', () => {
    const dir=mkdtempSync(join(tmpdir(),'sensor-acceptance-'));
    try {
      const file=join(dir,'fixture.json'), sql=join(dir,'provision.json'), cleanup=join(dir,'cleanup.json');
      const run=(phase:string,output:string,environment='staging')=>runCli([resolve('scripts/acceptance.ts'),phase,file,environment],{...process.env,ACCEPTANCE_SQL_EXPORT:output});
      const prepared=run('provision',sql); expect(prepared.status).toBe(0); expect(prepared.stdout).toContain('prepared_not_executed');
      const f=JSON.parse(readFileSync(file,'utf8')); const text=readFileSync(sql,'utf8');
      expect(statSync(file).mode&0o777).toBe(0o600); expect(statSync(sql).mode&0o777).toBe(0o600);
      for(const token of [f.token,f.session,f.otherSession]) { expect(text).not.toContain(token); expect(prepared.stdout).not.toContain(token); expect(text).toContain(createHash('sha256').update(token).digest('hex')); }
      const statements=JSON.parse(text).statements; expect(statements[0].text).toBe('BEGIN'); expect(statements.at(-1).text).toBe('COMMIT');
      expect(run('cleanup',cleanup,'prod').status).toBe(1);
      expect(run('ingest',join(dir,'no-http.json')).status).toBe(1);
      expect(run('cleanup',cleanup).status).toBe(0);
      const clean=readFileSync(cleanup,'utf8'); expect(clean).not.toContain('DELETE'); expect(clean).toContain('acceptance_run'); expect(clean).toContain(f.run);
      // Never overwrite credentials on retry; uncertain writes remain recoverable.
      expect(run('quota-seed',join(dir,'wrong-purpose.json')).status).toBe(1);
      expect(run('provision',sql).status).toBe(1); expect(JSON.parse(readFileSync(file,'utf8')).run).toBe(f.run);
    } finally { rmSync(dir,{recursive:true,force:true}); }
  },180_000);
  it('requires an isolated staging quota fixture and explicit configured limit/model attestation',()=>{
    const dir=mkdtempSync(join(tmpdir(),'sensor-quota-'));
    try {
      const file=join(dir,'fixture.json');
      const run=(phase:string,output:string,extra:Record<string,string>={})=>runCli([resolve('scripts/acceptance.ts'),phase,file,'staging'],{...process.env,ACCEPTANCE_SQL_EXPORT:output,...extra});
      expect(run('provision',join(dir,'provision.json'),{ACCEPTANCE_PURPOSE:'quota'}).status).toBe(0);
      expect(run('quota-seed',join(dir,'missing.json')).status).toBe(1);
      const config={ACCEPTANCE_ACTOR_LIMIT:'20',ACCEPTANCE_TENANT_LIMIT:'100',ACCEPTANCE_GLOBAL_LIMIT:'200',ACCEPTANCE_MODEL_DISABLED:'verified'};
      const output=join(dir,'seed.json'); expect(run('quota-seed',output,config).status).toBe(0);
      const statements=JSON.parse(readFileSync(output,'utf8')).statements;
      expect(statements.filter((q:{text:string})=>q.text.startsWith('INSERT INTO telemetry.sensor_ask_requests'))).toHaveLength(20);
      expect(JSON.stringify(statements)).not.toContain(JSON.parse(readFileSync(file,'utf8')).session);
      const audit=join(dir,'audit.json'); expect(run('quota-audit',audit,config).status).toBe(0);
      expect(readFileSync(audit,'utf8')).toContain('model_attempted');
      expect(run('quota-seed',join(dir,'oversize.json'),{...config,ACCEPTANCE_ACTOR_LIMIT:'21'}).status).toBe(1);
    }finally{rmSync(dir,{recursive:true,force:true});}
  },180_000);
  it('accepts the real Ask renderer through the gateway and leaves admission BUSY unproven',()=>{
    const dir=mkdtempSync(join(tmpdir(),'sensor-http-'));
    try {
      for(const mode of ['ask','busy']) {
        const file=join(dir,`${mode}.json`), correlation=join(dir,`${mode}-request.json`);
        const prepared=runCli(['scripts/acceptance.ts','provision',file,'staging'],{...process.env,ACCEPTANCE_PURPOSE:mode==='busy'?'quota':'pipeline',ACCEPTANCE_SQL_EXPORT:join(dir,`${mode}-sql.json`)});
        expect(prepared.status).toBe(0);
        const result=runCli(['src/acceptance-http-fixture.ts',mode,file],{...process.env,ACCEPTANCE_SQL_EXPORT:'',ACCEPTANCE_QUOTA_REQUEST:correlation});
        expect(result.status,result.stderr).toBe(mode==='busy'?2:0);
        if(mode==='busy') {
          expect(result.stdout).toContain('unproven_requires_durable_event');
          expect(result.stdout).not.toContain('"status":"pass"');
          const request=JSON.parse(readFileSync(correlation,'utf8')); const proof=join(dir,'proof.json');
          const confirm=()=>runCli(['scripts/acceptance.ts','quota-confirm',file,'staging'],{...process.env,ACCEPTANCE_SQL_EXPORT:'',ACCEPTANCE_QUOTA_REQUEST:correlation,ACCEPTANCE_QUOTA_PROOF:proof});
          writeFileSync(proof,'[]');expect(confirm().status).toBe(1);
          const entry={resource:{type:'cloud_run_revision',labels:{project_id:'albusforge-staging',service_name:'ask'}},jsonPayload:{event:'sensor_ask_quota_rejected',request_id:request.request_id,scope:'global'}};
          writeFileSync(proof,JSON.stringify([entry]));expect(confirm().status).toBe(1);
          entry.jsonPayload.scope='actor';writeFileSync(proof,JSON.stringify([entry]));expect(confirm().status).toBe(0);
        }
      }
    }finally{rmSync(dir,{recursive:true,force:true});}
  },180_000);
});
