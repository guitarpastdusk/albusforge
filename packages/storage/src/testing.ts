import {
  StorageNotFoundError, StoragePreconditionError, validateGeneration, validateObject,
  type ObjectIdentity, type ObservationStorage, type StoredObject, type ListOptions, type ObjectPage,
} from './index.js';

/** Deterministic create-only fake. Copies bytes and metadata so callers cannot mutate storage. */
export class MemoryObservationStorage implements ObservationStorage {
  private readonly objects = new Map<string, { bytes: Buffer; metadata: StoredObject; createdAt: string }>();
  private generation = 0n;
  constructor(private readonly maxBytes = 1_048_576, private readonly now = () => new Date()) {}
  get size(): number { return this.objects.size; }

  async create(key: string, bytes: Buffer, identity: ObjectIdentity, signal?: AbortSignal): Promise<StoredObject> {
    signal?.throwIfAborted(); validateObject(key, bytes, identity, this.maxBytes);
    if (this.objects.has(key)) throw new StoragePreconditionError();
    const metadata = { ...identity, bytes: bytes.length, generation: String(++this.generation) };
    this.objects.set(key, { bytes: Buffer.from(bytes), metadata, createdAt: this.now().toISOString() });
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
  async list(options: ListOptions, signal?: AbortSignal): Promise<ObjectPage> {
    signal?.throwIfAborted();
    const limit = options.limit ?? 100;
    if (!options.prefix || !Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('Invalid object listing');
    const keys = [...this.objects.keys()].filter(key => key.startsWith(options.prefix) && (!options.pageToken || key > options.pageToken)).sort();
    const page = keys.slice(0, limit);
    return { objects: page.map(key => { const value = this.objects.get(key)!; return { key, generation: value.metadata.generation, createdAt: value.createdAt }; }), nextPageToken: keys.length > limit ? page.at(-1)! : null };
  }
  async delete(key: string, generation: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted(); validateObject(key); validateGeneration(generation);
    const object = this.objects.get(key);
    // GCS generation-specific delete returns 404 when that generation is absent.
    if (object?.metadata.generation === generation) this.objects.delete(key);
  }
}
