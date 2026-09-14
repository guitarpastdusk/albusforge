import { createHash, randomUUID } from 'node:crypto';
import { Storage } from '@google-cloud/storage';
import { GoogleAuth, Impersonated } from 'google-auth-library';

export interface ListOptions { prefix: string; pageToken?: string; limit?: number }
export interface ListedObject { key: string; generation: string; createdAt: string }
export interface ObjectPage { objects: ListedObject[]; nextPageToken: string | null }
export interface ObjectIdentity { sha256: string; fingerprint: string }
export interface StoredObject extends ObjectIdentity { generation: string; bytes: number }
export interface ObservationStorage {
  create(key: string, bytes: Buffer, identity: ObjectIdentity, signal?: AbortSignal): Promise<StoredObject>;
  head(key: string, signal?: AbortSignal): Promise<StoredObject | null>;
  read(key: string, generation: string, signal?: AbortSignal): Promise<Buffer>;
  delete(key: string, generation: string, signal?: AbortSignal): Promise<void>;
  list(options: ListOptions, signal?: AbortSignal): Promise<ObjectPage>;
}

export class StoragePreconditionError extends Error {
  constructor() { super('Object generation precondition failed'); this.name = 'StoragePreconditionError'; }
}
export class StorageNotFoundError extends Error {
  constructor() { super('Object generation not found'); this.name = 'StorageNotFoundError'; }
}
export class StoragePermissionError extends Error {
  constructor() { super('Object storage permission denied'); this.name = 'StoragePermissionError'; }
}

export function validateObject(key: string, bytes?: Buffer, identity?: ObjectIdentity, maxBytes = 1_048_576): void {
  if (!key || Buffer.byteLength(key) > 1024 || /[\r\n\0]/.test(key)) throw new Error('Invalid object key');
  if (bytes && (bytes.length === 0 || bytes.length > maxBytes)) throw new Error('Invalid object size');
  if (identity && (!/^[a-f0-9]{64}$/.test(identity.sha256) || !/^[a-f0-9]{64}$/.test(identity.fingerprint))) {
    throw new Error('Invalid object identity');
  }
  if (bytes && identity && createHash('sha256').update(bytes).digest('hex') !== identity.sha256) {
    throw new Error('Object digest does not match bytes');
  }
}

export function validateGeneration(generation: string): void {
  if (!/^[1-9][0-9]*$/.test(generation)) throw new Error('Invalid object generation');
}

interface GcsObject { name?: string; timeCreated?: string; generation?: string; size?: string; metadata?: Record<string, string> }

/** Private GCS objects, using SDK ADC authentication and abortable JSON API calls.
 * No automatic retries: the caller reconciles ambiguous writes with head().
 */
export class GcsHttpObservationStorage implements ObservationStorage {
  private readonly client: Storage;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly base: string;
  private readonly upload: string;
  private readonly impersonateServiceAccount?: string;
  private impersonated?: Promise<Impersonated>;

  constructor(options: { bucket: string; timeoutMs?: number; maxBytes?: number; client?: Storage; impersonateServiceAccount?: string }) {
    if (!/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(options.bucket)) throw new Error('Invalid bucket');
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxBytes = options.maxBytes ?? 1_048_576;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 60_000) throw new Error('Invalid storage timeout');
    if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes < 1 || this.maxBytes > 16_777_216) throw new Error('Invalid storage byte limit');
    this.client = options.client ?? new Storage({ retryOptions: { autoRetry: false }, timeout: this.timeoutMs });
    this.impersonateServiceAccount = options.impersonateServiceAccount;
    this.base = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(options.bucket)}/o`;
    this.upload = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(options.bucket)}/o`;
  }

  private async request<T>(url: string, method: 'GET' | 'POST' | 'DELETE', signal?: AbortSignal, data?: Buffer, contentType?: string, binary = false): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('Storage deadline exceeded')), this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    try {
      combined.throwIfAborted();
      const requester = this.impersonateServiceAccount
        ? await (this.impersonated ??= new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient().then(sourceClient => new Impersonated({ sourceClient, targetPrincipal: this.impersonateServiceAccount!, targetScopes: ['https://www.googleapis.com/auth/devstorage.full_control'], lifetime: 600 })))
        : this.client.authClient;
      const response = await requester.request<T>({
        url, method, data, headers: contentType ? { 'Content-Type': contentType } : undefined,
        responseType: binary ? 'arraybuffer' : 'json', signal: combined,
        timeout: this.timeoutMs, retry: false, maxContentLength: this.maxBytes + 65_536,
      });
      return response.data;
    } catch (error) {
      const status = (error as { response?: { status?: number } }).response?.status;
      if (status === 412) throw new StoragePreconditionError();
      if (status === 404) throw new StorageNotFoundError();
      if (status === 403) throw new StoragePermissionError();
      throw error;
    } finally { clearTimeout(timer); }
  }

  private metadata(value: GcsObject): StoredObject {
    const bytes = Number(value.size);
    const sha256 = value.metadata?.sha256 ?? '';
    const fingerprint = value.metadata?.fingerprint ?? '';
    const generation = value.generation ?? '';
    validateGeneration(generation);
    validateObject('metadata', undefined, { sha256, fingerprint });
    if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > this.maxBytes) throw new Error('Invalid stored object size');
    return { generation, bytes, sha256, fingerprint };
  }

  async create(key: string, bytes: Buffer, identity: ObjectIdentity, signal?: AbortSignal): Promise<StoredObject> {
    validateObject(key, bytes, identity, this.maxBytes);
    const boundary = `observation-${randomUUID()}`;
    const metadata = JSON.stringify({ name: key, contentType: 'image/jpeg', metadata: identity });
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: image/jpeg\r\n\r\n`),
      bytes, Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const result = await this.request<GcsObject>(`${this.upload}?uploadType=multipart&ifGenerationMatch=0`, 'POST', signal, body, `multipart/related; boundary=${boundary}`);
    return this.metadata(result);
  }

  async head(key: string, signal?: AbortSignal): Promise<StoredObject | null> {
    validateObject(key);
    try { return this.metadata(await this.request<GcsObject>(`${this.base}/${encodeURIComponent(key)}`, 'GET', signal)); }
    catch (error) { if (error instanceof StorageNotFoundError) return null; throw error; }
  }

  async read(key: string, generation: string, signal?: AbortSignal): Promise<Buffer> {
    validateObject(key); validateGeneration(generation);
    const result = await this.request<ArrayBuffer>(`${this.base}/${encodeURIComponent(key)}?alt=media&generation=${generation}&ifGenerationMatch=${generation}`, 'GET', signal, undefined, undefined, true);
    const bytes = Buffer.from(result);
    if (bytes.length > this.maxBytes) throw new Error('Stored object exceeds byte limit');
    return bytes;
  }

  async list(options: ListOptions, signal?: AbortSignal): Promise<ObjectPage> {
    const limit = options.limit ?? 100;
    if (!options.prefix || options.prefix.length > 1024 || !Number.isInteger(limit) || limit < 1 || limit > 1000 || (options.pageToken?.length ?? 0) > 4096) throw new Error('Invalid object listing');
    const query = new URLSearchParams({ prefix: options.prefix, maxResults: String(limit), fields: 'items(name,generation,timeCreated),nextPageToken' });
    if (options.pageToken) query.set('pageToken', options.pageToken);
    const response = await this.request<{items?: GcsObject[]; nextPageToken?: string}>(`${this.base}?${query}`, 'GET', signal);
    if ((response.items?.length ?? 0) > limit) throw new Error('Oversized object listing');
    const objects = (response.items ?? []).map(item => {
      const key = item.name ?? ''; const generation = item.generation ?? ''; const createdAt = item.timeCreated ?? '';
      validateObject(key); validateGeneration(generation);
      if (!key.startsWith(options.prefix) || !Number.isFinite(Date.parse(createdAt))) throw new Error('Invalid listed object');
      return { key, generation, createdAt };
    });
    return { objects, nextPageToken: response.nextPageToken ?? null };
  }

  async delete(key: string, generation: string, signal?: AbortSignal): Promise<void> {
    validateObject(key); validateGeneration(generation);
    try { await this.request(`${this.base}/${encodeURIComponent(key)}?generation=${generation}&ifGenerationMatch=${generation}`, 'DELETE', signal); }
    catch (error) { if (!(error instanceof StorageNotFoundError)) throw error; }
  }
}
