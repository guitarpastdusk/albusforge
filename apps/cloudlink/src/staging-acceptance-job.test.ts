import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { MemoryObservationStorage } from '@albusforge/storage/testing';
import type { AcceptanceFixture } from './staging-acceptance.js';
import { acceptanceCleanupSql, acceptanceVerifySql, jobAcceptanceDatabase } from './staging-acceptance-job.js';
const fixture=():AcceptanceFixture=>{const tenant=randomUUID(),device=randomUUID(),observation=randomUUID();return{tenant,device,observation,key:`tenant/${tenant}/device/${device}/${observation}.jpg`,tokenHash:'a'.repeat(64),source:{kind:'staging-acceptance',run:tenant}};};
it('does not submit cleanup or provisioning when durable journal creation fails',async()=>{
  const execute=vi.fn(),f=fixture();const db=jobAcceptanceDatabase(execute,new MemoryObservationStorage(),async()=>{throw Error('disk failure');});
  await expect(db.provision(f)).rejects.toThrow('disk failure');await db.cleanup(f,false);expect(execute).not.toHaveBeenCalled();
});
it('retains fencing cleanup after an ambiguous provision response and never sends the bearer token',async()=>{
  const f=fixture(),execute=vi.fn().mockRejectedValueOnce(Error('ambiguous')).mockResolvedValue(undefined);
  const db=jobAcceptanceDatabase(execute,new MemoryObservationStorage(),async()=>{});
  await expect(db.provision(f)).rejects.toThrow('ambiguous');await db.cleanup(f,false);
  expect(execute.mock.calls[0]![0]).toContain(f.tokenHash);
  expect(execute.mock.calls[1]![0]).toContain('cleanup fence');expect(execute.mock.calls[1]![0]).not.toContain('DELETE FROM users.tenants');
});
it('rejects fixture escape, SQL injection, malformed generation and acknowledgment timestamp',()=>{
  const f=fixture();expect(()=>acceptanceCleanupSql({...f,key:'foreign/object'},false)).toThrow();
  const expected={sha256:'b'.repeat(64),bytes:100,receivedAt:'2026-09-14T00:00:00.000Z'};
  expect(()=>acceptanceVerifySql(f,expected,"1';DROP TABLE users.tenants;--")).toThrow();
  expect(()=>acceptanceVerifySql(f,{...expected,receivedAt:'bad'},'1')).toThrow();
  expect(()=>acceptanceCleanupSql({...f,source:{kind:'other',run:f.tenant}},false)).toThrow();
});

it('plans without cloud credentials and rejects production, duplicate and unapproved execution arguments',async()=>{
  const run=promisify(execFile);
  const cli=fileURLToPath(new URL('./staging-acceptance-job-cli.ts',import.meta.url));
  const command=[fileURLToPath(import.meta.resolve('tsx/cli')),cli];
  const args=['--project','albusforge-staging','--origin','https://staging.albusforge.ai','--bucket','albusforge-staging-observations'];
  const options={timeout:15000,env:{...process.env,CLOUDSDK_CONFIG:'/nonexistent-acceptance-config',GOOGLE_APPLICATION_CREDENTIALS:'/nonexistent-acceptance-credentials'}};
  expect(JSON.parse((await run(process.execPath,[...command,...args],options)).stdout).mode).toBe('plan-only');
  for(const invalid of [[...args,'--execute'],[...args,'--project','albusforge-prod'],['--project','albusforge-prod',...args.slice(2)]]) {
    await expect(run(process.execPath,[...command,...invalid],options)).rejects.toThrow();
  }
});
