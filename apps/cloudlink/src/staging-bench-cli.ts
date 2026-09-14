import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareBench, privateRead, readJournal, cleanupBenchSql, markBench, BENCH_ORIGIN } from './staging-bench.js';
import { executeBenchSql, verifyBenchJob, authenticatedCloud } from './staging-bench-job.js';

async function main() {
  const args = process.argv.slice(2), flags = new Map<string, string>();
  const permitted = new Set(['--execute', '--cleanup', '--project', '--origin', '--output', '--manifest', '--manifest-sha256', '--job-image']);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!permitted.has(arg) || flags.has(arg)) throw new Error('Bench invalid/repeated argument');
    if (arg === '--execute' || arg === '--cleanup') flags.set(arg, 'true');
    else { const value = args[++i]; if (!value || value.startsWith('--')) throw new Error('Bench missing argument'); flags.set(arg, value); }
  }
  if (flags.get('--project') !== 'albusforge-staging' || flags.get('--origin') !== BENCH_ORIGIN) throw new Error('Bench requires explicit exact staging project and origin');
  if (!flags.has('--execute')) { console.log(JSON.stringify({ mode: 'plan-only', action: flags.has('--cleanup') ? 'Revoke and remove exactly the journal device; retain durable image deletion intents and empty bench tenant' : 'Prepare private candidate configuration and create staging-only bench identity', interval_s: 900 })); return; }
  const output = flags.get('--output'); if (!output) throw new Error('Bench requires private output directory');
  const cloud = await authenticatedCloud();
  if (flags.has('--cleanup')) {
    if (flags.has('--manifest') || flags.has('--manifest-sha256')) throw new Error('Bench cleanup uses only the preserved journal binding');
    const journal = await readJournal(output);
    await executeBenchSql(cleanupBenchSql(journal), flags.get('--job-image') ?? journal.job_image, cloud);
    await markBench(output, 'revoked');
    console.log('{"status":"revoked","empty_bench_tenant_retained":true,"image_deletion":"durably queued; maintenance grace applies"}'); return;
  }
  const manifest = flags.get('--manifest'), digest = flags.get('--manifest-sha256'), image = flags.get('--job-image');
  if (!manifest || !digest || !image) throw new Error('Bench requires approved manifest path/digest and immutable staging job image');
  await verifyBenchJob(image, cloud);
  const prepared = await prepareBench(output, resolve(fileURLToPath(new URL('../../../', import.meta.url))), await privateRead(manifest), digest, image);
  await executeBenchSql(prepared.sql, image, cloud);
  await markBench(prepared.directory, 'ready');
  console.log('{"status":"ready","configuration":"private output directory","physical_acceptance":false}');
}
main().catch(() => { console.error('{"status":"failed","message":"Bench operation failed. Preserve private output and cleanup journal. If SQL execution started, use scoped cleanup before creating another fixture; do not install without ready.json."}'); process.exitCode = 1; });
