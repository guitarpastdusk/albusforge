import { EventEmitter } from 'node:events';
import { mkdtemp,mkdir,writeFile,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { Pool } from 'pg';
import { expect,it,vi } from 'vitest';
import { runOne } from './job';
import { compile } from './compiler';
it('discards an uncertain advisory admission session instead of returning its possible lock to the pool',async()=>{
  const release=vi.fn();const client=Object.assign(new EventEmitter(),{release,query:vi.fn().mockRejectedValue(Error('query deadline after server lock acquisition'))});
  const pool={connect:async()=>client,query:vi.fn()} as unknown as Pool;
  const build=vi.fn();
  await expect(runOne({pool,artifacts:{put:vi.fn(),get:vi.fn()},compile:build})).rejects.toThrow('query deadline');
  expect(release).toHaveBeenCalledExactlyOnceWith(true);expect(build).not.toHaveBeenCalled();expect(pool.query).not.toHaveBeenCalled();
});
it('retains compiler process ownership until abort closes the child and removes its workspace',async()=>{
  const root=await mkdtemp(join(tmpdir(),'albus-compiler-cancel-')),template=join(root,'template'),bin=join(root,'bin'),pidFile=join(root,'pid'),work=join(root,'work');
  await mkdir(join(template,'main/include'),{recursive:true});await mkdir(bin);
  await writeFile(join(bin,'idf.py'),`#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000);\n`,{mode:0o700});
  vi.stubEnv('PATH',`${bin}:${process.env.PATH}`);vi.stubEnv('FIRMWARE_WORK_DIR',work);
  const controller=new AbortController();
  const pending=compile({build_id:'00000000-0000-4000-8000-000000000000',plan_version:1,code_version:1,interval_s:60},template,'idf',controller.signal).then(()=>null,error=>error as Error);
  try {
    let pid=0;const deadline=Date.now()+5000;
    while(!pid&&Date.now()<deadline) {try{pid=Number(await readFile(pidFile,'utf8'));}catch{await delay(20);}}
    expect(pid).toBeGreaterThan(0);controller.abort();
    expect((await pending)?.message).toBe('Compile lease ownership lost');
    expect(()=>process.kill(pid,0)).toThrow();
    const {readdir}=await import('node:fs/promises');expect(await readdir(work)).toEqual([]);
  } finally {controller.abort();await pending;vi.unstubAllEnvs();await rm(root,{recursive:true,force:true});}
});
