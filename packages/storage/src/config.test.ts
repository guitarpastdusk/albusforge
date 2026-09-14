import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { observationStorageFromEnv } from './config.js';
it('keeps both service entry points disabled by default and refuses incomplete activation',()=>{
  for(const flag of ['OBSERVATION_UPLOADS_ENABLED','OBSERVATION_READS_ENABLED'] as const){
    expect(observationStorageFromEnv({},flag)).toBeUndefined();
    expect(()=>observationStorageFromEnv({[flag]:'true'},flag)).toThrow(flag);
    expect(()=>observationStorageFromEnv({[flag]:'1'},flag)).toThrow('CAMERA_IMAGES_BUCKET');
    expect(()=>observationStorageFromEnv({[flag]:'1',CAMERA_IMAGES_BUCKET:'test-bucket'},flag)).toThrow('OBSERVATION_STORAGE_WORKER_PATH');
  }
});
it('constructs an explicitly configured store without opening credentials or the network',()=>{
  const dir=mkdtempSync(join(tmpdir(),'observation-config-'));try{
    const worker=join(dir,'worker.cjs');writeFileSync(worker,'throw new Error("not started");');
    expect(()=>observationStorageFromEnv({OBSERVATION_UPLOADS_ENABLED:'1',CAMERA_IMAGES_BUCKET:'test-bucket',OBSERVATION_STORAGE_WORKER_PATH:dir},'OBSERVATION_UPLOADS_ENABLED')).toThrow('readable built storage worker');
    expect(observationStorageFromEnv({OBSERVATION_UPLOADS_ENABLED:'1',CAMERA_IMAGES_BUCKET:'test-bucket',OBSERVATION_STORAGE_WORKER_PATH:worker},'OBSERVATION_UPLOADS_ENABLED')).toBeDefined();
  }finally{rmSync(dir,{recursive:true,force:true});}
});
