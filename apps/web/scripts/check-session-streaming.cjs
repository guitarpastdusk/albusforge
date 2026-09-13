// Production streaming regression: run after pnpm --filter web build. Local stub only.
const http = require('node:http');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { performance } = require('node:perf_hooks');

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}
async function probe(tree) {
  let me = 0;
  const stub = http.createServer((req, res) => {
    const reply = () => {
      res.writeHead(req.url === '/v1/me' ? 503 : 501, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'NOT_IMPLEMENTED', message: 'reviewer stub' } }));
    };
    if (req.url === '/v1/me') { me++; setTimeout(reply, 1500); }
    else reply();
  });
  const stubPort = await listen(stub);
  const reserve = http.createServer();
  const port = await listen(reserve);
  await new Promise(resolve => reserve.close(resolve));
  let logs = '';
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], {
    cwd: tree + '/apps/web', env: { ...process.env, API_MODE: 'live', GATEWAY_INTERNAL_AUTH: 'none', GATEWAY_INTERNAL_URL: `http://127.0.0.1:${stubPort}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => logs += chunk);
  child.stderr.on('data', chunk => logs += chunk);
  try {
    const until = performance.now() + 15000;
    while (!logs.includes('Ready in')) {
      if (child.exitCode !== null || performance.now() > until) throw new Error('Server did not become ready: ' + logs);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    // Warm imports/compilation without consulting the session endpoint.
    await fetch(`http://127.0.0.1:${port}/`).then(r => r.text());
    const startLog = logs.length;
    const started = performance.now();
    const timings = await new Promise((resolve, reject) => {
      let body = '', first, hero;
      const req = http.get(`http://127.0.0.1:${port}/`, { headers: { cookie: '__Host-albus_session=' + 'a'.repeat(43) } }, res => {
        res.on('data', chunk => {
          first ??= performance.now() - started;
          body += chunk;
          if (body.includes('Physical AI, built from a sentence')) hero ??= performance.now() - started;
        });
        res.on('end', () => resolve({ status: res.statusCode, first_ms: Math.round(first), hero_ms: Math.round(hero), total_ms: Math.round(performance.now() - started) }));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.setTimeout(10000, () => req.destroy(new Error('probe timeout')));
    });
    await new Promise(resolve => setTimeout(resolve, 50));
    return { tree, ...timings, me_requests: me, session_warnings: (logs.slice(startLog).match(/session lookup failed; header shown signed out/g) || []).length };
  } finally {
    child.kill('SIGTERM');
    await once(child, 'exit');
    stub.closeAllConnections();
    await new Promise(resolve => stub.close(resolve));
  }
}
(async () => {
  const result = await probe(path.resolve(__dirname, '../../..'));
  console.log(JSON.stringify(result));
  assert.equal(result.status, 200);
  assert.equal(result.me_requests, 1);
  assert.equal(result.session_warnings, 1);
  assert.ok(result.hero_ms < 1000, `Hero waited for stalled session: ${result.hero_ms}ms`);
  assert.ok(result.total_ms >= 1400, 'Session stall was not exercised');
})().catch(error => { console.error(error); process.exitCode = 1; });
