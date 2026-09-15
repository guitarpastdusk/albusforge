import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { isAbsolute } from 'node:path';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';

export const STAGING_INSTANCE = 'albusforge-staging:us-central1:albusforge-staging-pg';
/** Launch our own proxy with immutable instance identity. An arbitrary preexisting
 * localhost listener is never accepted as evidence that a database is staging.
 */
export async function stagingProxy(binary: string, expectedSha256: string) {
  if (!isAbsolute(binary)) throw new Error('Acceptance proxy binary must be an absolute path');
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) throw new Error('Acceptance requires an approved proxy SHA256');
  const info = await stat(binary);
  if (!info.isFile() || info.size > 128*1024*1024 || createHash('sha256').update(await readFile(binary)).digest('hex') !== expectedSha256) throw new Error('Acceptance proxy binary does not match approved SHA256');
  const { stdout } = await promisify(execFile)(binary, ['--version'], { timeout: 5000, maxBuffer: 8192 });
  if (!/cloud.?sql.*proxy.*version\s+2\./i.test(stdout)) throw new Error('Acceptance requires Cloud SQL Auth Proxy v2');
  const port = await new Promise<number>((resolve, reject) => {
    const server = createServer(); server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const address = server.address(); server.close(error => error ? reject(error) : resolve((address as { port: number }).port)); });
  });
  const child = spawn(binary, ['--private-ip', '--address=127.0.0.1', `--port=${port}`, STAGING_INSTANCE], { stdio: ['ignore','pipe','pipe'] });
  let exited = false;
  const exit = new Promise<void>(resolve => { child.once('exit', () => { exited = true; resolve(); }); child.once('error', () => { exited = true; resolve(); }); });
  const close = async () => {
    if (exited) return;
    child.kill('SIGTERM'); const force = setTimeout(() => child.kill('SIGKILL'), 5000);
    try { await exit; } finally { clearTimeout(force); }
  };
  try {
    await new Promise<void>((resolve, reject) => {
      let text = '';
      const timer = setTimeout(() => reject(new Error('Acceptance staging proxy startup timed out')), 20_000);
      const output = (chunk: Buffer) => { text = (text + chunk.toString()).slice(-8192); if (text.includes(`Listening on 127.0.0.1:${port}`)) { clearTimeout(timer); resolve(); } };
      child.stdout.on('data', output); child.stderr.on('data', output);
      child.once('error', () => { clearTimeout(timer); reject(new Error('Acceptance staging proxy failed')); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('Acceptance staging proxy exited')); });
    });
    return { host: '127.0.0.1', port, close };
  } catch (error) { await close(); throw error; }
}
