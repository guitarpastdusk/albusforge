import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { stagingOrigin } from './staging-acceptance.js';
import { stagingProxy } from './staging-acceptance-proxy.js';

it('accepts only the exact credential-free staging HTTPS origin', () => {
  expect(stagingOrigin('https://staging.albusforge.ai')).toBe('https://staging.albusforge.ai');
  for (const value of ['https://albusforge.ai','http://staging.albusforge.ai','https://user:password@staging.albusforge.ai','https://staging.albusforge.ai/path','https://staging.albusforge.ai?url=production']) expect(() => stagingOrigin(value)).toThrow('Acceptance');
});
it('owns a proxy pinned to staging and closes the launched listener', async () => {
  const directory = await mkdtemp(join(tmpdir(),'staging-proxy-test-'));
  const binary = join(directory,'cloud-sql-proxy');
  await writeFile(binary, `#!${process.execPath}
if(process.argv.includes('--version')){console.log('cloud-sql-proxy version 2.20.0');process.exit(0);}
if(!process.argv.includes('albusforge-staging:us-central1:albusforge-staging-pg'))process.exit(1);
if(!process.argv.includes('--private-ip'))process.exit(1);
const port=Number(process.argv.find(x=>x.startsWith('--port=')).split('=')[1]);
const server=require('node:net').createServer();server.listen(port,'127.0.0.1',()=>console.log('Listening on 127.0.0.1:'+port));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
`, { mode: 0o700 });
  try {
    await expect(stagingProxy(binary,'0'.repeat(64))).rejects.toThrow('approved SHA256');
    const proxy = await stagingProxy(binary,createHash('sha256').update(await readFile(binary)).digest('hex'));
    expect(proxy.host).toBe('127.0.0.1'); expect(proxy.port).toBeGreaterThan(0); await proxy.close(); await proxy.close();
  }
  finally { await rm(directory,{recursive:true,force:true}); }
});
it('refuses unowned relative proxy executables', async () => {
  await expect(stagingProxy('cloud-sql-proxy','0'.repeat(64))).rejects.toThrow('absolute');
});
