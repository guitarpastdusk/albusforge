import { expect, it } from 'vitest';
import { parseAcceptanceArgs, runStorageAcceptance } from './acceptance.js';
import { MemoryObservationStorage } from './testing.js';
import { StoragePermissionError, type ObservationStorage } from './index.js';

it('requires explicit staging resources and defaults to no mutations', () => {
  expect(parseAcceptanceArgs(['--project','albusforge-staging','--bucket','albusforge-staging-observations']).execute).toBe(false);
  expect(() => parseAcceptanceArgs(['--project','albusforge-prod','--bucket','albusforge-prod-observations','--execute'])).toThrow('production');
  expect(() => parseAcceptanceArgs([])).toThrow('Explicit');
  expect(() => parseAcceptanceArgs(['--project','albusforge-staging','--bucket','other-bucket'])).toThrow('Explicit');
});
function role(store: ObservationStorage, permissions: string[]): ObservationStorage {
  return new Proxy(store, { get(target, name: string) {
    if (!permissions.includes(name)) return async () => { throw new StoragePermissionError(); };
    const method = Reflect.get(target, name) as (...args: unknown[]) => unknown;
    return method.bind(target);
  } });
}
it('exercises positive/negative IAM contracts and cleans all created generations', async () => {
  const store = new MemoryObservationStorage();
  const result = await runStorageAcceptance({ writer: role(store, ['create','head']), reader: role(store, ['head','read']), maintainer: role(store, ['head','read','list','delete']) });
  expect(result.status).toBe('passed'); expect(store.size).toBe(0);
});
it('fails excess permissions and still removes unexpected test writes', async () => {
  const store = new MemoryObservationStorage();
  await expect(runStorageAcceptance({ writer: role(store, ['create','head']), reader: role(store, ['head','read','create']), maintainer: role(store, ['head','read','list','delete']) })).rejects.toThrow('reader create unexpectedly permitted');
  expect(store.size).toBe(0);
});
