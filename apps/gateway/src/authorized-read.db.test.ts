import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createDb } from "@albusforge/db";
import { SESSION_COOKIE } from "@albusforge/schema";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, expect, it } from "vitest";
import { withAuthorizedRead } from "./authorized-read";
let container: StartedPostgreSqlContainer;
let handle: ReturnType<typeof createDb>;
beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  handle = createDb({ host: container.getHost(), port: container.getPort(), database: container.getDatabase(), user: container.getUsername(), password: container.getPassword(), ssl: "disable" });
  await handle.pool.query(`CREATE SCHEMA users;
    CREATE TABLE users.sessions(id uuid PRIMARY KEY,parent_session_id uuid,user_id uuid,active_tenant_id uuid,token_hash text,expires_at timestamptz,revoked_at timestamptz);
    CREATE TABLE users.tenants(id uuid PRIMARY KEY,slug text);
    CREATE TABLE users.tenant_members(tenant_id uuid,user_id uuid,role text);`);
});
afterAll(async () => { await handle?.pool.end(); await container?.stop(); });
async function identity() {
  const token = randomBytes(32).toString("base64url"), user = randomUUID(), tenant = randomUUID(), id = randomUUID();
  await handle.pool.query("INSERT INTO users.tenants VALUES($1,$2)", [tenant, `team-${tenant}`]);
  await handle.pool.query("INSERT INTO users.tenant_members VALUES($1,$2,'viewer')", [tenant,user]);
  await handle.pool.query("INSERT INTO users.sessions VALUES($1,NULL,$2,$3,$4,now()+interval '1 hour',NULL)", [id,user,tenant,createHash("sha256").update(token).digest("hex")]);
  return { id,user,tenant,cookie: `${SESSION_COOKIE}=${token}` };
}
it("allows viewer reads with a fenced client and read-only transaction", async () => {
  const owner = await identity();
  await withAuthorizedRead(handle.pool, owner.cookie, "localhost", async (client, context) => {
    expect(context).toEqual({ userId: owner.user, tenantId: owner.tenant, role: "viewer" });
    expect((await client.query("SHOW transaction_read_only")).rows[0].transaction_read_only).toBe("on");
  });
});
it("rejects revoked ancestors and absent parents, and requires membership on the selected host", async () => {
  const owner = await identity();
  await expect(withAuthorizedRead(handle.pool, owner.cookie, "unknown.albusforge.ai", async () => true)).rejects.toMatchObject({ statusCode: 404 });
  await handle.pool.query("UPDATE users.sessions SET parent_session_id=$1 WHERE id=$2", [randomUUID(),owner.id]);
  await expect(withAuthorizedRead(handle.pool, owner.cookie, "localhost", async () => true)).rejects.toMatchObject({ statusCode: 401 });
  const parent = await identity();
  await handle.pool.query("UPDATE users.sessions SET user_id=$1,revoked_at=now() WHERE id=$2", [owner.user,parent.id]);
  await handle.pool.query("UPDATE users.sessions SET parent_session_id=$1 WHERE id=$2", [parent.id,owner.id]);
  await expect(withAuthorizedRead(handle.pool, owner.cookie, "localhost", async () => true)).rejects.toMatchObject({ statusCode: 401 });
});
it("keeps authorization and later reads in one admitted snapshot", async () => {
  const owner = await identity();
  await withAuthorizedRead(handle.pool, owner.cookie, "localhost", async (client) => {
    await handle.pool.query("DELETE FROM users.tenant_members WHERE user_id=$1", [owner.user]);
    expect((await client.query("SELECT role FROM users.tenant_members WHERE user_id=$1", [owner.user])).rows).toEqual([{role:"viewer"}]);
  });
  await expect(withAuthorizedRead(handle.pool, owner.cookie, "localhost", async () => true)).rejects.toMatchObject({ statusCode: 403 });
});
