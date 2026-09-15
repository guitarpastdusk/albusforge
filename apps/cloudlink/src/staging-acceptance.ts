import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { ObservationStorage } from '@albusforge/storage';
import sharp from 'sharp';
import { ObservationAck } from '@albusforge/schema';

export function stagingOrigin(input: string): string {
  const url = new URL(input);
  if (url.origin !== 'https://staging.albusforge.ai' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Acceptance origin must be exactly https://staging.albusforge.ai');
  return url.origin;
}
const verify = (ok: unknown, check: string) => { if (!ok) throw new Error(`Acceptance failed: ${check}`); };

/** Credentials exist only in memory. Only this run's randomly allocated tenant,
 * device and object prefix are eligible for cleanup; no catalogue is modified.
 */
export interface AcceptanceFixture { tenant: string; device: string; observation: string; key: string; source: { kind: string; run: string }; tokenHash: string }
export interface AcceptanceExpected { sha256: string; bytes: number; receivedAt: string }
export interface AcceptanceDatabase {
  provision(fixture: AcceptanceFixture): Promise<void>;
  verify(fixture: AcceptanceFixture, expected: AcceptanceExpected): Promise<string>;
  cleanup(fixture: AcceptanceFixture, complete: boolean): Promise<void>;
}
export function runStagingIngest(pool: Pool, store: ObservationStorage, origin: string) {
  return runStagingIngestWithDatabase(poolAcceptanceDatabase(pool, store), store, origin);
}
export async function runStagingIngestWithDatabase(database: AcceptanceDatabase, store: ObservationStorage, origin: string) {
  const endpoint = stagingOrigin(origin);
  const tenant = randomUUID(), device = randomUUID(), observation = randomUUID();
  const token = randomBytes(32).toString('base64url');
  const source = { kind: 'staging-acceptance', run: tenant };
  const prefix = `tenant/${tenant}/device/${device}/`, key = `${prefix}${observation}.jpg`;
  const jpeg = await sharp({ create: { width: 320, height: 240, channels: 3, background: { r: 32, g: 150, b: 96 } } }).jpeg().toBuffer();
  const sha256 = createHash('sha256').update(jpeg).digest('hex');
  const fixture: AcceptanceFixture = { tenant, device, observation, key, source, tokenHash: createHash('sha256').update(token).digest('hex') };
  let provisioned = false, complete = false;
  try {
    provisioned = true;
    await database.provision(fixture);
    const captured = Math.floor(Date.now()/1000);
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'image/jpeg', 'x-observation-id': observation, 'x-capability-id': 'camera', 'x-payload-schema': 'jpeg.v1', 'x-captured-at': String(captured), 'x-content-sha256': sha256 };
    const post = async (path: string, body: string | Uint8Array, requestHeaders: Record<string,string>) => {
      const response = await fetch(`${endpoint}${path}`, { method: 'POST', redirect: 'error', headers: requestHeaders, body, signal: AbortSignal.timeout(30_000) });
      const reader=response.body?.getReader();let responseBody='';
      if(reader) {let size=0;const chunks:Buffer[]=[];try {while(true) {const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>8192)throw Error('Acceptance response too large');chunks.push(Buffer.from(chunk.value));}responseBody=Buffer.concat(chunks).toString('utf8');}finally{await reader.cancel();}}
      return { status: response.status, body: responseBody };
    };
    const path = `/ingest/v2/devices/${device}/observations`;
    const first = await post(path, new Uint8Array(jpeg), headers);
    verify(first.status === 201, 'new image status');
    const ack = ObservationAck.parse(JSON.parse(first.body));
    verify(ack.observation_id === observation && ack.sha256 === sha256 && ack.bytes === jpeg.length && ack.state === 'stored', 'image acknowledgment identity');
    const duplicate = await post(path, new Uint8Array(jpeg), headers);
    verify(duplicate.status === 200 && duplicate.body === first.body, 'stable replay');
    verify((await post(path, new Uint8Array(jpeg), { ...headers, 'x-captured-at': String(captured-1) })).status === 409, 'immutable conflict');
    const numeric = { v: 1, dev: device, seq: 1, ts: captured, r: [{ c: 'temperature_c', t: captured, v: 22 }], st: { up_s: 60, health: ['OK'] } };
    for (let i=0;i<2;i++) verify((await post('/ingest/v1', JSON.stringify(numeric), { authorization: `Bearer ${token}`, 'content-type': 'application/json' })).status === 202, 'numeric v1 replay');
    const generation = await database.verify(fixture, { sha256, bytes: jpeg.length, receivedAt: ack.received_at });
    const objects = await store.list({ prefix, limit: 10 });
    verify(objects.objects.length === 1 && !objects.nextPageToken && objects.objects[0]?.generation === generation, 'one immutable GCS object');
    verify((await store.read(key, generation)).equals(jpeg), 'GCS exact JPEG bytes');
    complete = true;
    return { status: 'passed', device, observation, imageStatuses: [201,200,409], numericStatuses: [202,202], jpegBytes: jpeg.length };
  } finally {
    if (provisioned) await database.cleanup(fixture, complete);
  }
}

async function cleanupStagingFixture(pool: Pool, store: ObservationStorage, fixture: { tenant: string; device: string; key: string; source: { kind: string; run: string } }, complete: boolean) {
  const { tenant, device, key, source } = fixture;
  try {
    await pool.query("UPDATE telemetry.devices SET revoked_at=now() WHERE id=$1 AND tenant_id=$2 AND source=$3::jsonb", [device, tenant, source]);
    await pool.query('INSERT INTO telemetry.observation_deletion_intents(object_key) VALUES($1) ON CONFLICT DO NOTHING', [key]);
    await pool.query("DELETE FROM users.tenants WHERE id=$1 AND name='Staging observation acceptance'", [tenant]);
    if (complete) {
      const object = await store.head(key); if (object) await store.delete(key, object.generation);
      await pool.query('DELETE FROM telemetry.observation_deletion_intents WHERE object_key=$1', [key]);
    }
  } catch { throw new Error(`Acceptance fixture cleanup failed: tenant=${tenant}, device=${device}, object=${key}; inspect only this staging-acceptance fixture`); }
}

function poolAcceptanceDatabase(pool: Pool, store: ObservationStorage): AcceptanceDatabase {
  return {
    async provision({ tenant, device, tokenHash, source }) {
    const client = await pool.connect();
    let discard = false;
    try {
      await client.query('BEGIN');
      await client.query("INSERT INTO users.tenants(id,name) VALUES($1,'Staging observation acceptance')", [tenant]);
      await client.query('INSERT INTO telemetry.devices(id,tenant_id,token_hash,channels,source) VALUES($1,$2,$3,$4,$5)', [device, tenant, tokenHash, { temperature_c: { unit: 'C', min: -40, max: 85 } }, source]);
      await client.query("INSERT INTO telemetry.device_capabilities(device_id,capability_id,kind,payload_schema,profile_id,profile_version,interval_s,max_bytes,max_width,max_height) VALUES($1,'camera','image','jpeg.v1','acceptance-synthetic',1,900,1048576,320,240)", [device]);
      await client.query("INSERT INTO telemetry.device_capabilities(device_id,capability_id,kind,payload_schema,profile_id,profile_version,interval_s,channels) VALUES($1,'temperature','measurement','readings.v1','acceptance-synthetic',1,60,$2)", [device, { temperature_c: { unit: 'C', min: -40, max: 85 } }]);
      await client.query('COMMIT');
    } catch (error) { discard = true; await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(discard); }
    },
    async verify({ device, key }, { sha256, bytes, receivedAt }) {
    const receipt = (await pool.query('SELECT r.state,r.sha256,r.bytes,r.received_at,i.object_key,i.generation FROM telemetry.observation_receipts r JOIN telemetry.observation_images i USING(device_id,observation_id) WHERE r.device_id=$1', [device])).rows;
    verify(receipt.length === 1 && receipt[0].state === 'stored' && receipt[0].object_key === key && receipt[0].sha256 === sha256 && receipt[0].bytes === bytes, 'one SQL image receipt');
    verify(receipt[0].received_at.toISOString() === receivedAt, 'stable receipt timestamp');
    const usage = (await pool.query('SELECT accepted_count,accepted_bytes FROM telemetry.observation_usage WHERE device_id=$1', [device])).rows;
    verify(usage.length === 1 && usage[0].accepted_count === '1' && usage[0].accepted_bytes === String(bytes), 'image usage exactly once');
    verify(Number((await pool.query('SELECT count(*) AS n FROM telemetry.readings WHERE device_id=$1', [device])).rows[0].n) === 1, 'numeric reading exactly once');
    verify(Number((await pool.query('SELECT count(*) AS n FROM telemetry.packets WHERE device_id=$1', [device])).rows[0].n) === 1, 'numeric receipt exactly once');
      return String(receipt[0].generation);
    },
    cleanup: (fixture, complete) => cleanupStagingFixture(pool, store, fixture, complete),
  };
}
