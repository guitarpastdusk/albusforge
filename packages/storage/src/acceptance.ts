import { createHash, randomUUID } from 'node:crypto';
import { acceptanceJpeg } from './acceptance-fixture.js';
import { StorageNotFoundError, StoragePermissionError, StoragePreconditionError, type ObservationStorage } from './index.js';

export interface AcceptanceConfig { project: 'albusforge-staging'; bucket: 'albusforge-staging-observations'; execute: boolean }
export function parseAcceptanceArgs(args: string[]): AcceptanceConfig {
  let project: string | undefined, bucket: string | undefined; let execute = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--project' && !project) project = args[++i];
    else if (args[i] === '--bucket' && !bucket) bucket = args[++i];
    else if (args[i] === '--execute' && !execute) execute = true;
    else throw new Error('Usage: --project albusforge-staging --bucket albusforge-staging-observations [--execute]');
  }
  if (project !== 'albusforge-staging' || bucket !== 'albusforge-staging-observations') throw new Error('Explicit staging project and managed staging bucket required; production is forbidden');
  return { project, bucket, execute };
}

function requireResult(value: unknown, name: string): asserts value { if (!value) throw new Error(`Acceptance failed: ${name}`); }
async function expectedFailure(action: () => Promise<unknown>, expected: typeof StoragePermissionError | typeof StoragePreconditionError | typeof StorageNotFoundError, name: string) {
  try { await action(); } catch (error) { if (error instanceof expected) return; throw error; }
  throw new Error(`Acceptance failed: ${name} unexpectedly permitted`);
}

/** A unique prefix only; every possible test write is cleaned by exact generation.
 * Permission tests first prove each identity can perform its positive operation.
 */
export async function runStorageAcceptance(stores: { writer: ObservationStorage; reader: ObservationStorage; maintainer: ObservationStorage }, nonce = randomUUID(), verifyPrivate?: (key: string) => Promise<void>) {
  if (!/^[0-9a-f-]{36}$/.test(nonce)) throw new Error('Invalid acceptance run ID');
  const prefix = `acceptance/${nonce}/`;
  const key = `${prefix}synthetic.jpg`;
  const forbiddenReader = `${prefix}reader-must-not-create.jpg`, forbiddenMaintainer = `${prefix}maintainer-must-not-create.jpg`;
  const sha256 = createHash('sha256').update(acceptanceJpeg).digest('hex');
  const identity = { sha256, fingerprint: createHash('sha256').update(`acceptance:${nonce}`).digest('hex') };
  const keys = [key, forbiddenReader, forbiddenMaintainer];
  let failure: unknown;
  let result: { status: string; prefix: string; jpegBytes: number; checks: number } | undefined;
  try {
    const first = await stores.writer.create(key, acceptanceJpeg, identity);
    requireResult(first.bytes === acceptanceJpeg.length && first.sha256 === sha256 && first.fingerprint === identity.fingerprint, 'create metadata');
    const head = await stores.writer.head(key);
    requireResult(head?.generation === first.generation && head.sha256 === sha256 && head.fingerprint === identity.fingerprint && head.bytes === acceptanceJpeg.length, 'writer head');
    requireResult((await stores.reader.read(key, first.generation)).equals(acceptanceJpeg), 'reader exact bytes');
    if (verifyPrivate) await verifyPrivate(key);
    const listed = await stores.maintainer.list({ prefix, limit: 10 });
    requireResult(listed.objects.some(o => o.key === key && o.generation === first.generation && Number.isFinite(Date.parse(o.createdAt))), 'maintenance listing');
    await expectedFailure(() => stores.writer.create(key, acceptanceJpeg, identity), StoragePreconditionError, 'create-only duplicate');
    await expectedFailure(() => stores.writer.create(key, acceptanceJpeg, { ...identity, fingerprint: 'b'.repeat(64) }), StoragePreconditionError, 'conflicting duplicate');
    await expectedFailure(() => stores.writer.delete(key, first.generation), StoragePermissionError, 'writer delete');
    await expectedFailure(() => stores.writer.list({ prefix }), StoragePermissionError, 'writer list');
    await expectedFailure(() => stores.reader.create(forbiddenReader, acceptanceJpeg, identity), StoragePermissionError, 'reader create');
    await expectedFailure(() => stores.reader.delete(key, first.generation), StoragePermissionError, 'reader delete');
    await expectedFailure(() => stores.reader.list({ prefix }), StoragePermissionError, 'reader list');
    await expectedFailure(() => stores.maintainer.create(forbiddenMaintainer, acceptanceJpeg, identity), StoragePermissionError, 'maintainer create');
    await stores.maintainer.delete(key, first.generation);
    await expectedFailure(() => stores.reader.read(key, first.generation), StorageNotFoundError, 'deleted generation read');
    const replacement = await stores.writer.create(key, acceptanceJpeg, identity);
    requireResult(replacement.generation !== first.generation, 'new generation');
    await stores.maintainer.delete(key, first.generation);
    requireResult((await stores.reader.read(key, replacement.generation)).equals(acceptanceJpeg), 'stale delete preserves replacement');
    result = { status: 'passed', prefix, jpegBytes: acceptanceJpeg.length, checks: verifyPrivate ? 17 : 16 };
  } catch (error) { failure = error; }
  finally {
    const failures: string[] = [];
    for (const candidate of keys) {
      try { const object = await stores.maintainer.head(candidate); if (object) await stores.maintainer.delete(candidate, object.generation); }
      catch { failures.push(candidate); }
    }
    if (failures.length) failure = new Error(`Acceptance cleanup incomplete; retry generation-safe cleanup for ${failures.join(', ')}`);
  }
  if (failure) throw failure;
  return result!;
}
