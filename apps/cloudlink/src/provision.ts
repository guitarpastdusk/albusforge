import { randomBytes, randomUUID } from "node:crypto";
import { open, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import type { PoolClient } from "pg";
import { createDb, dbConfigFromEnv } from "@albusforge/db";
import { tokenHash } from "./routes.js";
import { localDatabase, simulatorChannels } from "./local.js";

// No HTTP provisioning route. This command is exclusively a local simulator bootstrap.
const output = process.argv[2];
if (!output || process.argv.length !== 3) throw new Error("Usage: pnpm --filter cloudlink provision /absolute/path/device.json");
const config = dbConfigFromEnv();
localDatabase(config.host);
const file = await open(resolve(output), "wx", 0o600);
const { pool } = createDb(config, { max: 1, connectTimeoutMs: 5000, statementTimeoutMs: 10000, queryTimeoutMs: 11000 });
let client: PoolClient | undefined;
try {
  client = await pool.connect();
  const tenant = randomUUID();
  const dev = randomUUID();
  const token = randomBytes(32).toString("base64url");
  await client.query("BEGIN");
  await client.query("INSERT INTO users.tenants(id,name) VALUES($1,'Local telemetry simulator')", [tenant]);
  await client.query("INSERT INTO telemetry.devices(id,tenant_id,token_hash,channels,source) VALUES($1,$2,$3,$4,$5)",
    [dev, tenant, tokenHash(token), simulatorChannels, { kind: "simulator", contract: "climate-demo.v1" }]);
  await file.writeFile(JSON.stringify({ dev, token }) + "\n");
  await file.sync();
  await client.query("COMMIT");
  console.log(`Provisioned local simulator device ${dev}; credential saved to ${resolve(output)}`);
} catch {
  await client?.query("ROLLBACK").catch(() => {});
  await unlink(resolve(output)).catch(() => {});
  throw new Error("Local provisioning failed; no credential retained");
} finally {
  client?.release(true);
  await file.close();
  await pool.end();
}
