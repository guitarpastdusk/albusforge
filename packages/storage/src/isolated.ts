import { Worker } from 'node:worker_threads';
import {
  StorageNotFoundError, StoragePreconditionError, StoragePermissionError, validateObject, validateGeneration,
  type ObservationStorage, type ObjectIdentity, type StoredObject, type ListOptions, type ObjectPage,
} from './transport.js';

/** Each operation owns a worker, including ADC discovery/refresh. On deadline or
 * cancellation terminate and await it: credentials cannot outlive the request.
 * GCS can still commit an ambiguous upload; the receipt owner reconciles it.
 */
export class GcsObservationStorage implements ObservationStorage {
  private active = 0;
  private readonly timeoutMs: number;
  constructor(private readonly options: { bucket: string; timeoutMs?: number; maxBytes?: number; maxWorkers?: number; workerPath?: string | URL; impersonateServiceAccount?: string }) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
    if (!/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(options.bucket)) throw new Error('Invalid bucket');
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 60_000) throw new Error('Invalid storage timeout');
    if (!Number.isSafeInteger(options.maxBytes ?? 1_048_576) || (options.maxBytes ?? 1_048_576) < 1 || (options.maxBytes ?? 1_048_576) > 16_777_216) throw new Error('Invalid storage byte limit');
    if (!Number.isInteger(options.maxWorkers ?? 4) || (options.maxWorkers ?? 4) < 1 || (options.maxWorkers ?? 4) > 32) throw new Error('Invalid worker limit');
  }
  private async run<T>(operation: string, args: unknown[], signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    if (this.active >= (this.options.maxWorkers ?? 4)) throw new Error('Storage workers busy');
    this.active++;
    let worker: Worker | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel: (() => void) | undefined;
    try {
      worker = new Worker(this.options.workerPath ?? process.env.OBSERVATION_STORAGE_WORKER_PATH ?? new URL('../dist/storage-worker.cjs', import.meta.url), {
        workerData: { operation, args, options: { bucket: this.options.bucket, timeoutMs: this.timeoutMs, maxBytes: this.options.maxBytes, impersonateServiceAccount: this.options.impersonateServiceAccount } },
        resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16 },
      });
      return await new Promise<T>((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Storage deadline exceeded')), this.timeoutMs);
        cancel = () => reject(signal?.reason ?? new Error('Storage cancelled'));
        signal?.addEventListener('abort', cancel, { once: true });
        if (signal?.aborted) cancel();
        worker!.once('error', reject);
        worker!.once('exit', code => reject(new Error(`Storage worker exited before response (${code})`)));
        worker!.once('message', (message: { result?: T; error?: { name: string; message: string } }) => {
          if (message.error) {
            if (message.error.name === 'StorageNotFoundError') reject(new StorageNotFoundError());
            else if (message.error.name === 'StoragePreconditionError') reject(new StoragePreconditionError());
            else if (message.error.name === 'StoragePermissionError') reject(new StoragePermissionError());
            else reject(new Error('Storage operation failed'));
          } else resolve(message.result as T);
        });
      });
    } finally {
      if (timer) clearTimeout(timer);
      if (cancel) signal?.removeEventListener('abort', cancel);
      try { if (worker) await worker.terminate(); }
      finally { this.active--; }
    }
  }
  create(key: string, bytes: Buffer, identity: ObjectIdentity, signal?: AbortSignal): Promise<StoredObject> {
    validateObject(key, bytes, identity, this.options.maxBytes);
    return this.run('create', [key, bytes, identity], signal);
  }
  head(key: string, signal?: AbortSignal): Promise<StoredObject | null> { validateObject(key); return this.run('head', [key], signal); }
  async read(key: string, generation: string, signal?: AbortSignal): Promise<Buffer> {
    validateObject(key); validateGeneration(generation);
    return Buffer.from(await this.run<Uint8Array>('read', [key, generation], signal));
  }
  delete(key: string, generation: string, signal?: AbortSignal): Promise<void> { validateObject(key); validateGeneration(generation); return this.run('delete', [key, generation], signal); }
  list(options: ListOptions, signal?: AbortSignal): Promise<ObjectPage> { return this.run('list', [options], signal); }
}
