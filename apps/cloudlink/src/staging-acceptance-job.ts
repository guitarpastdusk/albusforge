import type { ObservationStorage } from '@albusforge/storage';
import { z } from 'zod';
import type { AcceptanceDatabase, AcceptanceExpected, AcceptanceFixture } from './staging-acceptance.js';

export type AcceptanceSql = (sql: string) => Promise<void>;
const uuid = z.uuid();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
// Every interpolated value is generated locally or schema checked, then quoted.
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
function fields(f: AcceptanceFixture) {
  uuid.parse(f.tenant); uuid.parse(f.device); uuid.parse(f.observation); digest.parse(f.tokenHash);
  if (f.source.kind !== 'staging-acceptance' || f.source.run !== f.tenant || f.key !== `tenant/${f.tenant}/device/${f.device}/${f.observation}.jpg`) throw new Error('Acceptance invalid fixture ownership');
  return { tenant: quote(f.tenant), device: quote(f.device), key: quote(f.key), source: quote(JSON.stringify(f.source)), hash: quote(f.tokenHash) };
}
const tenantName = "'Staging observation acceptance'", fenceName = "'Staging observation acceptance cleanup fence'";
export function acceptanceProvisionSql(f: AcceptanceFixture) {
  const { tenant, device, source, hash } = fields(f);
  return `BEGIN;
INSERT INTO users.tenants(id,name) VALUES(${tenant},${tenantName});
INSERT INTO telemetry.devices(id,tenant_id,token_hash,channels,source) VALUES(${device},${tenant},${hash},'{"temperature_c":{"unit":"C","min":-40,"max":85}}',${source});
INSERT INTO telemetry.device_capabilities(device_id,capability_id,kind,payload_schema,profile_id,profile_version,interval_s,max_bytes,max_width,max_height) VALUES(${device},'camera','image','jpeg.v1','acceptance-synthetic',1,900,1048576,320,240);
INSERT INTO telemetry.device_capabilities(device_id,capability_id,kind,payload_schema,profile_id,profile_version,interval_s,channels) VALUES(${device},'temperature','measurement','readings.v1','acceptance-synthetic',1,60,'{"temperature_c":{"unit":"C","min":-40,"max":85}}');
COMMIT;`;
}
export function acceptanceVerifySql(f: AcceptanceFixture, expected: AcceptanceExpected, generation: string) {
  const { device, key, tenant, source } = fields(f);
  digest.parse(expected.sha256); z.number().int().min(1).max(1048576).parse(expected.bytes);
  z.iso.datetime().parse(expected.receivedAt); z.string().regex(/^[1-9][0-9]*$/).parse(generation);
  return `DO $$ BEGIN
IF (SELECT count(*) FROM telemetry.devices WHERE id=${device} AND tenant_id=${tenant} AND source=${source}::jsonb AND revoked_at IS NULL) <> 1
OR (SELECT count(*) FROM telemetry.observation_receipts WHERE device_id=${device}) <> 1
OR (SELECT count(*) FROM telemetry.observation_receipts r JOIN telemetry.observation_images i USING(device_id,observation_id) WHERE r.device_id=${device} AND r.observation_id=${quote(f.observation)} AND r.state='stored' AND r.sha256=${quote(expected.sha256)} AND r.bytes=${expected.bytes} AND r.received_at=${quote(expected.receivedAt)}::timestamptz AND i.object_key=${key} AND i.generation=${quote(generation)}) <> 1
OR (SELECT count(*) FROM telemetry.observation_usage WHERE device_id=${device} AND accepted_count=1 AND accepted_bytes=${expected.bytes}) <> 1
OR (SELECT count(*) FROM telemetry.observation_usage WHERE device_id=${device}) <> 1
OR (SELECT count(*) FROM telemetry.readings WHERE device_id=${device}) <> 1
OR (SELECT count(*) FROM telemetry.packets WHERE device_id=${device}) <> 1
THEN RAISE EXCEPTION 'acceptance verification failed'; END IF;
END $$;`;
}
export function acceptanceCleanupSql(f: AcceptanceFixture, complete: boolean) {
  const { tenant, device, key, source } = fields(f);
  // A permanent unique tenant fence prevents an ambiguously submitted provision
  // job from creating credentials after cleanup, even if it starts much later.
  return `BEGIN;
INSERT INTO users.tenants(id,name) VALUES(${tenant},${fenceName}) ON CONFLICT DO NOTHING;
SELECT id FROM users.tenants WHERE id=${tenant} FOR UPDATE;
SELECT id FROM telemetry.devices WHERE id=${device} FOR UPDATE;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM telemetry.devices WHERE id=${device} AND (tenant_id<>${tenant} OR source IS DISTINCT FROM ${source}::jsonb)) OR NOT EXISTS(SELECT 1 FROM users.tenants WHERE id=${tenant} AND name IN (${tenantName},${fenceName})) OR EXISTS(SELECT 1 FROM telemetry.devices WHERE tenant_id=${tenant} AND (id<>${device} OR source IS DISTINCT FROM ${source}::jsonb)) THEN RAISE EXCEPTION 'acceptance cleanup ownership mismatch'; END IF; END $$;
UPDATE users.tenants SET name=${fenceName} WHERE id=${tenant};
UPDATE telemetry.devices SET revoked_at=now() WHERE id=${device} AND tenant_id=${tenant} AND source=${source}::jsonb;
INSERT INTO telemetry.observation_deletion_intents(object_key) VALUES(${key}) ON CONFLICT(object_key) DO UPDATE SET queued_at=now();
DELETE FROM telemetry.devices WHERE id=${device} AND tenant_id=${tenant} AND source=${source}::jsonb;
${complete ? `DELETE FROM users.tenants WHERE id=${tenant} AND name=${fenceName};` : ''}
COMMIT;`;
}

export function jobAcceptanceDatabase(execute: AcceptanceSql, store: ObservationStorage, journal: (fixture: AcceptanceFixture) => Promise<void>): AcceptanceDatabase {
  let attempted = false;
  return {
    async provision(fixture) { fields(fixture); await journal(fixture); attempted = true; await execute(acceptanceProvisionSql(fixture)); },
    async verify(fixture, expected) {
      const objects = await store.list({ prefix: `tenant/${fixture.tenant}/device/${fixture.device}/`, limit: 10 });
      const object = objects.objects[0];
      if (objects.objects.length !== 1 || objects.nextPageToken || !object || object.key !== fixture.key) throw new Error('Acceptance requires exactly one fixture object');
      await execute(acceptanceVerifySql(fixture, expected, object.generation));
      return object.generation;
    },
    async cleanup(fixture, complete) {
      if (!attempted) return;
      try {
        await execute(acceptanceCleanupSql(fixture, complete));
        if (complete) {
          const object = await store.head(fixture.key);
          if (object) await store.delete(fixture.key, object.generation);
          await execute(`DELETE FROM telemetry.observation_deletion_intents WHERE object_key=${fields(fixture).key};`);
        }
      } catch { throw new Error(`Acceptance remote cleanup failed: tenant=${fixture.tenant}, device=${fixture.device}, object=${fixture.key}; retain the local journal and run scoped cleanup`); }
    },
  };
}
