import { test as base, expect } from "@playwright/test";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import path from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";

const root = path.resolve(import.meta.dirname, "../../..");
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function listen(server: http.Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as { port: number }).port;
}
async function freePort() {
  const server = http.createServer();
  const port = await listen(server);
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
  try { await exited; } finally { clearTimeout(timer); }
}
async function ready(url: string, child: ChildProcess) {
  for (let i = 0; i < 50; i++) {
    if (child.exitCode !== null) throw new Error("Local acceptance service exited before readiness");
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return; } catch { /* still starting */ }
    await delay(100);
  }
  throw new Error(`Local acceptance service did not become ready: ${url}`);
}
function processEnv(extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  // Fixed local endpoints override inherited application/provider configuration.
  const env = { ...process.env, ...extra };
  for (const key of ["K_SERVICE", "K_REVISION", "INTERNAL_AUTH_AUDIENCE", "SSR_SERVICE_ACCOUNT", "ASK_URL", "RESEND_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_APPLICATION_CREDENTIALS"]) delete env[key];
  return env;
}

export interface Stack {
  webUrl: string;
  gatewayUrl: string;
  pool: pg.Pool;
  codeFor(email: string): Promise<string>;
}

export const test = base.extend<{ stack: Stack }>({
  stack: [async ({}, runTest) => {
    const container = await new PostgreSqlContainer("postgres:16-alpine").start();
    const children: ChildProcess[] = [];
    let pool: pg.Pool | undefined;
    let intake: http.Server | undefined;
    try {
      const admin = new pg.Client({ connectionString: container.getConnectionUri() });
      await admin.connect();
      try {
        await admin.query("CREATE ROLE albus_migrate LOGIN CREATEROLE PASSWORD 'local-migrate'");
        await admin.query("CREATE DATABASE albus OWNER albus_migrate");
      } finally { await admin.end(); }
      const dbEnv = {
        DB_HOST: container.getHost(), DB_PORT: String(container.getPort()), DB_NAME: "albus",
        DB_USER: "albus_migrate", DB_PASSWORD: "local-migrate", DB_SSL: "disable",
      };
      const migrate = spawn(process.execPath, ["packages/db/dist/migrate.js"], {
        timeout: 60_000, cwd: root, env: processEnv({ ...dbEnv, DB_APP_ROLE: "albus_app", DB_APP_PASSWORD: "local-app" }), stdio: ["ignore", "pipe", "pipe"],
      });
      children.push(migrate);
      // Drain, without publishing database configuration or provider secrets.
      migrate.stdout?.resume(); migrate.stderr?.resume();
      const [migrationCode] = await once(migrate, "exit");
      if (migrationCode !== 0) throw new Error("Disposable database migration failed");
      pool = new pg.Pool({ host: dbEnv.DB_HOST, port: Number(dbEnv.DB_PORT), database: "albus", user: "albus_app", password: "local-app", max: 3 });
      const db = pool;
      // Deterministic replacement for intake only. Gateway still persists user messages,
      // calls HTTP intake, reads real PostgreSQL and delivers its actual SSE stream.
      intake = http.createServer(async (req, res) => {
        try {
          if (req.method !== "POST" || req.url !== "/v1/turns") { res.writeHead(404).end(); return; }
          let body = "";
          for await (const chunk of req) body += String(chunk);
          const { build_id: buildId } = JSON.parse(body) as { build_id: string };
          const client = await db.connect();
          let messageId: string | null = null;
          try {
            await client.query("BEGIN");
            const owner = (await client.query("SELECT tenant_id, anon_owner_hash FROM builds.builds WHERE id=$1 FOR UPDATE", [buildId])).rows[0];
            const latest = (await client.query("SELECT role FROM builds.build_messages WHERE build_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1", [buildId])).rows[0];
            if (owner && latest?.role === "user") {
              messageId = randomUUID();
              await client.query("INSERT INTO builds.build_messages(id,build_id,role,text) VALUES($1,$2,'assistant','Fixture intake: your monitoring brief is saved.')", [messageId, buildId]);
              await client.query("INSERT INTO builds.llm_calls(build_id,tenant_id,anon_owner_hash,stage,model,input_tokens,output_tokens,cost_usd) VALUES($1,$2,$3,'intake','browser-fixture',120,24,'0.000123')", [buildId, owner.tenant_id, owner.anon_owner_hash]);
            }
            await client.query("COMMIT");
          } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
          res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(messageId ? { message_id: messageId, spec_version: null, status: "asking" } : { noop: true }));
        } catch { res.writeHead(500).end(); }
      });
      const intakePort = await listen(intake);
      const gatewayPort = await freePort();
      const codes = new Map<string, string>();
      const gateway = spawn(process.execPath, ["apps/gateway/dist/server.js"], {
        cwd: root,
        env: processEnv({ ...dbEnv, DB_USER: "albus_app", DB_PASSWORD: "local-app", PORT: String(gatewayPort), EMAIL_ADAPTER: "log", INTAKE_URL: `http://127.0.0.1:${intakePort}`, INTAKE_AUTH: "none", ASK_AUTH: "none" }),
        stdio: ["ignore", "pipe", "pipe"],
      });
      children.push(gateway);
      // Native local-only email adapter is an in-memory sink. Codes are never printed.
      let partial = "";
      gateway.stdout?.on("data", chunk => {
        partial += String(chunk);
        const lines = partial.split("\n"); partial = lines.pop()!;
        for (const line of lines) {
          try { const entry = JSON.parse(line); if (entry.message === "sign-in code (log email adapter)") codes.set(entry.to, entry.code); } catch { /* non-JSON startup line */ }
        }
      });
      gateway.stderr?.resume();
      await ready(`http://127.0.0.1:${gatewayPort}/readyz`, gateway);
      const webPort = await freePort();
      const webUrl = `http://127.0.0.1:${webPort}`;
      const web = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(webPort)], {
        cwd: path.join(root, "apps/web"),
        env: processEnv({ API_MODE: "live", GATEWAY_INTERNAL_AUTH: "none", GATEWAY_INTERNAL_URL: `http://127.0.0.1:${gatewayPort}` }),
        stdio: ["ignore", "pipe", "pipe"],
      });
      children.push(web); web.stdout?.resume(); web.stderr?.resume();
      await ready(`${webUrl}/signin`, web);
      await runTest({ webUrl, gatewayUrl: `http://127.0.0.1:${gatewayPort}`, pool: db, async codeFor(email) {
        for (let i = 0; i < 100; i++) { const code = codes.get(email); if (code) { codes.delete(email); return code; } await delay(50); }
        throw new Error("No email arrived in the local acceptance sink");
      } });
    } finally {
      for (const child of children.reverse()) await stop(child);
      if (intake) { intake.closeAllConnections(); await new Promise<void>(resolve => intake!.close(() => resolve())); }
      await pool?.end();
      await container.stop();
    }
  }, { timeout: 120_000 }],
});
export { expect };
