import { parentPort, workerData } from 'node:worker_threads';
import { GcsHttpObservationStorage, type ObjectIdentity, type ListOptions } from './transport.js';

async function main() {
  const { options, operation, args } = workerData;
  const store = new GcsHttpObservationStorage(options);
  switch (operation) {
    case 'create': return store.create(args[0], Buffer.from(args[1]), args[2] as ObjectIdentity);
    case 'head': return store.head(args[0]);
    case 'read': return store.read(args[0], args[1]);
    case 'delete': return store.delete(args[0], args[1]);
    case 'list': return store.list(args[0] as ListOptions);
    default: throw new Error('Invalid storage operation');
  }
}
main().then(result => parentPort?.postMessage({ result }), error => parentPort?.postMessage({ error: { name: error.name, message: 'Storage operation failed' } }));
