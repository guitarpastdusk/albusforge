import { GcsObservationStorage } from './index.js';
import { parseAcceptanceArgs, runStorageAcceptance } from './acceptance.js';

async function main() {
  const config = parseAcceptanceArgs(process.argv.slice(2));
  const accounts = { writer: 'cloudlink-run', reader: 'gateway-run', maintainer: 'observation-maintain-run' };
  if (!config.execute) {
    console.log(JSON.stringify({ mode: 'plan-only', project: config.project, bucket: config.bucket, accounts, action: 'Use --execute only after infrastructure approval and apply; creates and cleans unique synthetic JPEG fixtures.' }));
    return;
  }
  const store = (name: string) => new GcsObservationStorage({ bucket: config.bucket, timeoutMs: 20_000, maxWorkers: 1, impersonateServiceAccount: `${name}@${config.project}.iam.gserviceaccount.com` });
  console.log(JSON.stringify(await runStorageAcceptance({ writer: store(accounts.writer), reader: store(accounts.reader), maintainer: store(accounts.maintainer) }, undefined, async key => {
    const response = await fetch(`https://storage.googleapis.com/${config.bucket}/${key}`, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
    await response.arrayBuffer();
    if (![401,403].includes(response.status)) throw new Error('Acceptance failed: unsigned object read was not denied');
  })));
}
main().catch(error => {
  // Only controlled test errors carry details; SDK error bodies may contain credential context.
  console.error(JSON.stringify({ status: 'failed', message: error instanceof Error && /^(Acceptance |Explicit staging|Usage:)/.test(error.message) ? error.message : 'Storage acceptance failed; verify ADC impersonation, bucket/IAM and worker packaging.' }));
  process.exitCode = 1;
});
