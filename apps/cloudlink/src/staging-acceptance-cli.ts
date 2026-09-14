import { createDb, dbConfigFromEnv } from '@albusforge/db';
import { GcsObservationStorage } from '@albusforge/storage';
import { runStagingIngest, stagingOrigin } from './staging-acceptance.js';
import { stagingProxy, STAGING_INSTANCE } from './staging-acceptance-proxy.js';
import type { Pool } from 'pg';

async function main() {
  const args = process.argv.slice(2);
  const value = (name: string) => args[args.indexOf(name)+1];
  const permitted = new Set(['--execute','--project','--origin','--bucket','--proxy-binary','--proxy-sha256']);
  const seen = new Set<string>();
  for (let i=0;i<args.length;i++) {
    const argument = args[i]!;
    if (!permitted.has(argument) || seen.has(argument)) throw new Error('Acceptance invalid or repeated arguments');
    seen.add(argument);
    if (argument !== '--execute') { if (!args[i+1] || args[i+1]!.startsWith('--')) throw new Error('Acceptance missing argument value'); i++; }
  }
  if (!args.includes('--project') || value('--project') !== 'albusforge-staging' || !args.includes('--bucket') || value('--bucket') !== 'albusforge-staging-observations' || !args.includes('--origin')) throw new Error('Acceptance requires explicit staging project, bucket and HTTPS origin');
  const origin = stagingOrigin(value('--origin')!);
  if (!args.includes('--execute')) { console.log(JSON.stringify({ mode: 'plan-only', origin, instance: STAGING_INSTANCE, action: 'Create isolated fixture, post synthetic JPEG/numeric data, verify SQL/GCS once, clean fixture; --execute requires approved deployed staging.' })); return; }
  if (!args.includes('--proxy-binary') || !args.includes('--proxy-sha256')) throw new Error('Acceptance requires --proxy-binary /absolute/path/cloud-sql-proxy and --proxy-sha256 from its approved source');
  const config = dbConfigFromEnv();
  if (config.user !== 'albus_app' || config.database !== 'albusforge') throw new Error('Acceptance requires restricted albus_app role and albusforge database');
  const proxy = await stagingProxy(value('--proxy-binary')!, value('--proxy-sha256')!);
  let pool: Pool | undefined;
  try {
    ({ pool } = createDb({ ...config, host: proxy.host, port: proxy.port, ssl: 'disable' }, { max: 1, connectTimeoutMs: 5000, statementTimeoutMs: 10000, queryTimeoutMs: 11000 }));
    pool.on('error', () => console.error('{"status":"warning","message":"Acceptance database connection failed"}'));
    const store = new GcsObservationStorage({ bucket: 'albusforge-staging-observations', timeoutMs: 20_000, maxWorkers: 1, impersonateServiceAccount: 'observation-maintain-run@albusforge-staging.iam.gserviceaccount.com', workerPath: process.env.OBSERVATION_STORAGE_WORKER_PATH });
    console.log(JSON.stringify(await runStagingIngest(pool, store, origin)));
  } finally { try { await pool?.end(); } finally { await proxy.close(); } }
}
main().catch(error => { console.error(JSON.stringify({ status: 'failed', message: error instanceof Error && error.message.startsWith('Acceptance') ? error.message : 'Acceptance failed; inspect staging deployment, owned proxy, restricted SQL credentials and object IAM. Fixture failures retain durable cleanup intents.' })); process.exitCode = 1; });
