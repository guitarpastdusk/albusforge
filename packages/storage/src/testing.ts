import {
  StorageNotFoundError, StoragePreconditionError, validateGeneration, validateObject,
  type ObjectIdentity, type ObservationStorage, type StoredObject,
} from './index.js';

/** Deterministic create-only fake. Copies bytes and metadata so callers cannot mutate storage. */
export class MemoryObservationStorage implements ObservationStorage {
  private readonly objects = new Map<string, { bytes: Buffer; metadata: StoredObject }>();
  private generation = 0n;
  constructor(private readonly maxBytes = 1_048_576) {}
  get size(): number { return this.objects.size; }

  async create(key: string, bytes: Buffer, identity: ObjectIdentity, signal?: AbortSignal): Promise<StoredObject> {
    signal?.throwIfAborted(); validateObject(key, bytes, identity, this.maxBytes);
    if (this.objects.has(key)) throw new StoragePreconditionError();
    const metadata = { ...identity, bytes: bytes.length, generation: String(++this.generation) };
    this.objects.set(key, { bytes: Buffer.from(bytes), metadata });
    return { ...metadata };
  }
  async head(key: string, signal?: AbortSignal): Promise<StoredObject | null> {
    signal?.throwIfAborted(); validateObject(key);
    const object = this.objects.get(key);
    return object ? { ...object.metadata } : null;
  }
  async read(key: string, generation: string, signal?: AbortSignal): Promise<Buffer> {
    signal?.throwIfAborted(); validateObject(key); validateGeneration(generation);
    const object = this.objects.get(key);
    if (!object || object.metadata.generation !== generation) throw new StorageNotFoundError();
    return Buffer.from(object.bytes);
  }
  async delete(key: string, generation: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted(); validateObject(key); validateGeneration(generation);
    const object = this.objects.get(key);
    // GCS generation-specific delete returns 404 when that generation is absent.
    if (object?.metadata.generation === generation) this.objects.delete(key);
  }
}
