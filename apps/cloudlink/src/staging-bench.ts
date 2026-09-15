import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, mkdir, realpath, lstat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { DeviceConfigV2, FirmwareManifest } from '@albusforge/schema';
import { z } from 'zod';

export const BENCH_PROFILE = 'freenove-esp32s3-n16r8-gc0308-usb-v1';
export const BENCH_ORIGIN = 'https://staging.albusforge.ai';
export const BENCH_CHANNELS = { ambient_light_lux: { unit: 'lux', min: 0, max: 65535 }, air_temperature_c: { unit: 'C', min: -40, max: 85 }, air_pressure_hpa: { unit: 'hPa', min: 300, max: 1100 }, air_humidity_pct: { unit: '%', min: 0, max: 100 } };
export const BenchJournal = z.strictObject({ v: z.literal(1), kind: z.literal('staging-camera-bench'), project: z.literal('albusforge-staging'), origin: z.literal(BENCH_ORIGIN), tenant: z.uuid(), device: z.uuid(), run: z.uuid(), manifest_digest: z.string().regex(/^[a-f0-9]{64}$/), job_image: z.string().regex(/^us-central1-docker\.pkg\.dev\/albusforge-ci\/albusforge\/db-jobs@sha256:[a-f0-9]{64}$/) });
export type BenchJournal = z.infer<typeof BenchJournal>;
export const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const exactChannels = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const channels = value as Record<string, unknown>;
  return Object.keys(channels).length === 4 && Object.entries(BENCH_CHANNELS).every(([key, expected]) => {
    const actual = channels[key];
    return !!actual && typeof actual === 'object' && !Array.isArray(actual) &&
      (actual as Record<string, unknown>).unit === expected.unit &&
      (actual as Record<string, unknown>).min === expected.min &&
      (actual as Record<string, unknown>).max === expected.max &&
      Object.keys(actual as Record<string, unknown>).length === 3;
  });
};
export function benchManifest(bytes: Buffer, approvedDigest: string) {
  if (bytes.length > 16384 || !/^[a-f0-9]{64}$/.test(approvedDigest) || sha256(bytes) !== approvedDigest) throw new Error('Bench manifest does not match approved digest');
  const manifest = FirmwareManifest.parse(JSON.parse(bytes.toString('utf8')));
  const cap = manifest.capabilities;
  const camera = cap?.[0], environment = cap?.[1];
  if (manifest.profile_id !== BENCH_PROFILE || manifest.runtime !== '0.3.0' || !exactChannels(manifest.channels) || cap?.length !== 2 || camera?.id !== 'camera' || camera.kind !== 'image' || camera.schema !== 'jpeg.v1' || camera.profile_id !== BENCH_PROFILE || camera.profile_version !== 1 || !camera.enabled || !camera.required || camera.interval_s !== 900 || camera.max_bytes !== 1048576 || camera.max_width !== 320 || camera.max_height !== 240 || environment?.id !== 'environment' || environment.kind !== 'measurement' || environment.schema !== 'readings.v1' || environment.profile_id !== BENCH_PROFILE || environment.profile_version !== 1 || !environment.enabled || !environment.required || environment.interval_s !== 900 || !exactChannels(environment.channels)) throw new Error('Bench requires the reviewed 900-second native Plant A candidate');
  return manifest;
}
export async function privateRead(path: string, max = 16384): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const stat = await handle.stat(); if (!stat.isFile() || stat.size > max) throw new Error('Bench invalid input file'); return await handle.readFile(); } finally { await handle.close(); }
}
async function privateWrite(path: string, value: unknown) {
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
}
export async function prepareBench(directory: string, repo: string, manifestBytes: Buffer, digest: string, jobImage: string) {
  const manifest = benchManifest(manifestBytes, digest);
  if (!isAbsolute(directory)) throw new Error('Bench output must be an absolute new directory');
  const parent = await realpath(dirname(directory));
  const root = await realpath(repo);
  const target = join(parent, directory.split('/').at(-1)!);
  const rel = relative(root, target);
  if (!rel.startsWith('../') && rel !== '..') throw new Error('Bench private output must be outside the repository');
  const journal = BenchJournal.parse({ v: 1, kind: 'staging-camera-bench', project: 'albusforge-staging', origin: BENCH_ORIGIN, tenant: randomUUID(), device: randomUUID(), run: randomUUID(), manifest_digest: digest, job_image: jobImage });
  const token = randomBytes(32).toString('base64url');
  const config = DeviceConfigV2.parse({ v: 2, device_id: journal.device, token, ingest_url: `${BENCH_ORIGIN}/ingest/v1`, observation_url: `${BENCH_ORIGIN}/ingest/v2/devices/${journal.device}/observations`, seq_start: 0, profile_id: manifest.profile_id, runtime: manifest.runtime, channels: manifest.channels, capabilities: manifest.capabilities, build_id: manifest.build_id, plan_version: manifest.plan_version, code_version: manifest.code_version, manifest_digest: digest });
  await mkdir(target, { mode: 0o700 });
  // Journal reaches disk before SQL can run. It contains no recoverable bearer.
  await privateWrite(join(target, 'cleanup.json'), journal);
  await privateWrite(join(target, 'device-config.json'), config);
  const dir = await open(target, constants.O_RDONLY); try { await dir.sync(); } finally { await dir.close(); }
  const parentHandle = await open(parent, constants.O_RDONLY); try { await parentHandle.sync(); } finally { await parentHandle.close(); }
  return { journal, sql: createBenchSql(journal, sha256(token)), directory: target };
}
export async function readJournal(directory: string) {
  const stat = await lstat(directory);
  if (!stat.isDirectory() || (stat.mode & 0o077)) throw new Error('Bench journal directory must be private');
  return BenchJournal.parse(JSON.parse((await privateRead(join(directory, 'cleanup.json'))).toString('utf8')));
}
const literal = (value: unknown) => `'${String(typeof value === 'object' ? JSON.stringify(value) : value).replaceAll("'", "''")}'`;
const source = (j: BenchJournal) => ({ kind: j.kind, run: j.run, manifest_digest: j.manifest_digest });
export function createBenchSql(input: BenchJournal, tokenHash: string) {
  const j = BenchJournal.parse(input);
  if (!/^[a-f0-9]{64}$/.test(tokenHash)) throw new Error('Bench invalid credential hash');
  return `BEGIN;
INSERT INTO users.tenants(id,name) VALUES(${literal(j.tenant)},${literal(`Staging camera bench ${j.run}`)});
INSERT INTO telemetry.devices(id,tenant_id,token_hash,channels,source,next_s) VALUES(${literal(j.device)},${literal(j.tenant)},${literal(tokenHash)},${literal(BENCH_CHANNELS)}::jsonb,${literal(source(j))}::jsonb,900);
INSERT INTO telemetry.device_capabilities(device_id,capability_id,kind,payload_schema,profile_id,profile_version,enabled,required,interval_s,max_bytes,max_width,max_height) VALUES(${literal(j.device)},'camera','image','jpeg.v1',${literal(BENCH_PROFILE)},1,true,true,900,1048576,320,240);
INSERT INTO telemetry.device_capabilities(device_id,capability_id,kind,payload_schema,profile_id,profile_version,enabled,required,interval_s,channels) VALUES(${literal(j.device)},'environment','measurement','readings.v1',${literal(BENCH_PROFILE)},1,true,true,900,${literal(BENCH_CHANNELS)}::jsonb);
COMMIT;`;
}
export function cleanupBenchSql(input: BenchJournal) {
  const j = BenchJournal.parse(input);
  // Keep the empty dedicated tenant: never cascade unrelated tenant resources.
  // Deleting the scoped device queues every reserved/stored image via the DB trigger.
  return `BEGIN;
INSERT INTO users.tenants(id,name) VALUES(${literal(j.tenant)},${literal(`Staging camera bench ${j.run}`)}) ON CONFLICT(id) DO NOTHING;
DO $bench$ BEGIN
PERFORM 1 FROM users.tenants WHERE id=${literal(j.tenant)} FOR UPDATE;
IF NOT EXISTS(SELECT 1 FROM users.tenants WHERE id=${literal(j.tenant)} AND name=${literal(`Staging camera bench ${j.run}`)}) THEN RAISE EXCEPTION 'Bench tenant ownership mismatch'; END IF;
PERFORM 1 FROM telemetry.devices WHERE id=${literal(j.device)} FOR UPDATE;
IF EXISTS(SELECT 1 FROM telemetry.devices WHERE id=${literal(j.device)} AND (tenant_id<>${literal(j.tenant)}::uuid OR source<>${literal(source(j))}::jsonb)) THEN RAISE EXCEPTION 'Bench ownership mismatch'; END IF;
PERFORM 1 FROM telemetry.devices WHERE id=${literal(j.device)} AND tenant_id=${literal(j.tenant)} AND source=${literal(source(j))}::jsonb FOR UPDATE;
UPDATE telemetry.devices SET revoked_at=now() WHERE id=${literal(j.device)} AND tenant_id=${literal(j.tenant)} AND source=${literal(source(j))}::jsonb;
INSERT INTO telemetry.observation_deletion_intents(object_key,generation)
 SELECT object_key,generation FROM telemetry.observation_images WHERE device_id=${literal(j.device)}
 ON CONFLICT(object_key) DO UPDATE SET queued_at=now(), generation=COALESCE(EXCLUDED.generation,observation_deletion_intents.generation);
DELETE FROM telemetry.devices WHERE id=${literal(j.device)} AND tenant_id=${literal(j.tenant)} AND source=${literal(source(j))}::jsonb;
END $bench$;
COMMIT;`;
}
export async function markBench(directory: string, status: 'ready' | 'revoked') { await privateWrite(join(directory, `${status}.json`), { status, at: new Date().toISOString() }); }
