import { readFileSync } from "node:fs";
import path from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq, sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClientDb, createDb } from "./client.js";
import type { DbConfig } from "./config.js";
import { MIGRATIONS_FOLDER, runMigrations } from "./migrate.js";
import { APP_SCHEMAS, buildMessages, builds, llmCalls, tenants } from "./schema/index.js";

const MIGRATE_ROLE = { user: "albus_migrate", password: "migrate-secret" };
const journal = JSON.parse(readFileSync(path.join(MIGRATIONS_FOLDER, "meta/_journal.json"), "utf8")) as {
  entries: unknown[];
};

let container: StartedPostgreSqlContainer;
let admin: pg.Client;
let databases = 0;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  admin = new pg.Client({ connectionString: container.getConnectionUri() });
  await admin.connect();
  // Stands in for the Cloud SQL owner: not a superuser, but can create roles.
  await admin.query(`CREATE ROLE albus_migrate LOGIN CREATEROLE PASSWORD '${MIGRATE_ROLE.password}'`);
});

afterAll(async () => {
  await admin?.end();
  await container?.stop();
});

/** An empty database owned by albus_migrate, as Terraform leaves it. */
async function freshDatabase(): Promise<DbConfig> {
  const database = `albus_${++databases}`;
  await admin.query(`CREATE DATABASE ${database} OWNER albus_migrate`);
  // Cloud SQL API users reach CREATE through cloudsqlsuperuser. Granting it to
  // PUBLIC here gives the app role that same path, so the revoke is tested.
  await admin.query(`GRANT CREATE ON DATABASE ${database} TO PUBLIC`);
  return {
    host: container.getHost(),
    port: container.getPort(),
    database,
    user: MIGRATE_ROLE.user,
    password: MIGRATE_ROLE.password,
    ssl: "disable",
  };
}

async function withClient<T>(config: DbConfig, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ ...config, ssl: false });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

const appliedCount = (config: DbConfig) =>
  withClient(config, async (c) => Number((await c.query("SELECT count(*) FROM drizzle.__drizzle_migrations")).rows[0].count));

/** The Postgres SQLSTATE, whether pg threw directly or Drizzle wrapped it. */
async function sqlState(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    const e = error as { code?: string; cause?: { code?: string } };
    return e.code ?? e.cause?.code;
  }
  return undefined;
}

describe("runMigrations", () => {
  it("applies every migration to an empty database", async () => {
    const config = await freshDatabase();
    await runMigrations(config);

    expect(await appliedCount(config)).toBe(journal.entries.length);
    const schemas = await withClient(config, async (c) =>
      (
        await c.query(
          `SELECT nspname FROM pg_namespace
            WHERE nspname NOT LIKE 'pg\\_%' AND nspname NOT IN ('information_schema', 'public', 'drizzle')`,
        )
      ).rows.map((row) => row.nspname),
    );
    // Guards APP_SCHEMAS: a schema it misses would get no grants.
    expect(schemas.sort()).toEqual([...APP_SCHEMAS].sort());
  });

  it("is a no-op when run again", async () => {
    const config = await freshDatabase();
    await runMigrations(config);
    await runMigrations(config);
    expect(await appliedCount(config)).toBe(journal.entries.length);
  });

  it("lets two concurrent runs both succeed", async () => {
    const config = await freshDatabase();
    await Promise.all([runMigrations(config), runMigrations(config)]);
    expect(await appliedCount(config)).toBe(journal.entries.length);
  });
});

describe("constraints", () => {
  let handle: ReturnType<typeof createDb>;

  beforeAll(async () => {
    const config = await freshDatabase();
    await runMigrations(config);
    handle = createDb(config, { max: 2 });
  });

  afterAll(async () => {
    await handle?.pool.end();
  });

  it("rejects a build with neither a tenant nor an anonymous owner", async () => {
    const { db } = handle;
    expect(await sqlState(db.insert(builds).values({ askText: "no owner" }))).toBe("23514");
    await db.insert(builds).values({ askText: "anonymous", anonOwnerHash: "hash-a" });
  });

  it("makes client_message_id unique per build", async () => {
    const { db } = handle;
    const [build] = await db.insert(builds).values({ askText: "fridge", anonOwnerHash: "hash-b" }).returning();
    const message = { buildId: build!.id, role: "user" as const, text: "hi", clientMessageId: "c-1" };

    await db.insert(buildMessages).values(message);
    expect(await sqlState(db.insert(buildMessages).values(message))).toBe("23505");

    // Assistant messages carry no client id; NULLs never collide.
    await db.insert(buildMessages).values([
      { buildId: build!.id, role: "assistant", text: "one" },
      { buildId: build!.id, role: "assistant", text: "two" },
    ]);
  });

  it("keeps llm_calls when their build is deleted", async () => {
    const { db } = handle;
    const [build] = await db.insert(builds).values({ askText: "expired", anonOwnerHash: "hash-c" }).returning();
    const [call] = await db
      .insert(llmCalls)
      .values({ buildId: build!.id, anonOwnerHash: "hash-c", stage: "intake", model: "m", costUsd: "0.012" })
      .returning();

    await db.delete(builds).where(eq(builds.id, build!.id));

    const [kept] = await db.select().from(llmCalls).where(eq(llmCalls.id, call!.id));
    expect(kept?.buildId).toBeNull();
    expect(kept?.costUsd).toBe("0.012000");
  });
});

describe("app role", () => {
  let config: DbConfig;

  beforeAll(async () => {
    config = await freshDatabase();
    await runMigrations(config, { appRole: { name: "albus_app", password: "first-secret" } });
    // A second run updates the password in place.
    await runMigrations(config, { appRole: { name: "albus_app", password: "app-secret" } });
  });

  const asApp = (password = "app-secret"): DbConfig => ({ ...config, user: "albus_app", password });

  it("logs in with the current password only", async () => {
    expect(await sqlState(withClient(asApp("first-secret"), async () => {}))).toBe("28P01");
    const attrs = await withClient(asApp(), async (c) => {
      const { rows } = await c.query(
        "SELECT rolinherit, rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = current_user",
      );
      return rows[0];
    });
    expect(attrs).toEqual({ rolinherit: false, rolsuper: false, rolcreatedb: false, rolcreaterole: false });
  });

  it("reads and writes the tables", async () => {
    const { db, pool } = createDb(asApp(), { max: 1 });
    try {
      const [tenant] = await db.insert(tenants).values({ name: "Personal" }).returning();
      const [build] = await db.insert(builds).values({ askText: "greenhouse", tenantId: tenant!.id }).returning();
      await db.update(builds).set({ status: "specifying" }).where(eq(builds.id, build!.id));
      const [read] = await db.select().from(builds).where(eq(builds.id, build!.id));
      expect(read?.status).toBe("specifying");
      await db.delete(builds).where(eq(builds.id, build!.id));
      expect(await db.select({ n: sql<number>`count(*)::int` }).from(builds)).toEqual([{ n: 0 }]);
    } finally {
      await pool.end();
    }
  });

  it("retains observation deletion intents after tenant cascade as the restricted app role", async () => {
    await withClient(asApp(), async c => {
      const { rows: [tenant] } = await c.query("INSERT INTO users.tenants (name) VALUES ('Camera cleanup') RETURNING id");
      const { rows: [device] } = await c.query(`INSERT INTO telemetry.devices (tenant_id, token_hash, channels, source)
        VALUES ($1, 'cleanup-token', '{}'::jsonb, '{}'::jsonb) RETURNING id`, [tenant.id]);
      await c.query(`INSERT INTO telemetry.device_capabilities
        (device_id, capability_id, kind, payload_schema, profile_id, profile_version, interval_s, max_bytes, max_width, max_height)
        VALUES ($1, 'camera.front', 'image', 'jpeg.v1', 'test-camera', 1, 900, 1048576, 320, 240)`, [device.id]);
      const { rows: [receipt] } = await c.query(`INSERT INTO telemetry.observation_receipts
        (device_id, observation_id, capability_id, fingerprint, sha256, bytes, captured_at, received_at, expires_at, state, reserved_day)
        VALUES ($1, gen_random_uuid(), 'camera.front', repeat('a',64), repeat('b',64), 100, now(), now(), now()+interval '30 days', 'stored', '2026-09-14')
        RETURNING observation_id`, [device.id]);
      await c.query(`INSERT INTO telemetry.observation_images
        (device_id, observation_id, object_key, generation, width, height)
        VALUES ($1, $2, 'test/cleanup.jpeg', '123', 320, 240)`, [device.id, receipt.observation_id]);
      await c.query("DELETE FROM users.tenants WHERE id=$1", [tenant.id]);
      expect((await c.query("SELECT count(*)::int AS n FROM telemetry.observation_receipts WHERE device_id=$1", [device.id])).rows).toEqual([{ n: 0 }]);
      expect((await c.query("SELECT generation FROM telemetry.observation_deletion_intents WHERE object_key='test/cleanup.jpeg'")).rows).toEqual([{ generation: '123' }]);
      // The cleanup role can acknowledge work without the now-deleted owner.
      await c.query("DELETE FROM telemetry.observation_deletion_intents WHERE object_key='test/cleanup.jpeg'");
    });
  });

  it("cannot run DDL", async () => {
    await withClient(asApp(), async (c) => {
      for (const schema of [...APP_SCHEMAS, "public"]) {
        expect(await sqlState(c.query(`CREATE TABLE "${schema}".sneaky (id int)`)), schema).toBe("42501");
      }
      expect(await sqlState(c.query("CREATE SCHEMA sneaky"))).toBe("42501");
      expect(await sqlState(c.query("DROP TABLE builds.builds"))).toBe("42501");
    });
  });
});

describe("app role memberships", () => {
  /** A database with `name` provisioned, and a NOLOGIN role that can CREATE in an app schema. */
  async function setUp(name: string, ddlRole: string) {
    const config = await freshDatabase();
    await runMigrations(config, { appRole: { name, password: "app-secret" } });
    await admin.query(`CREATE ROLE ${ddlRole} NOLOGIN`);
    await withClient({ ...config, user: container.getUsername(), password: container.getPassword() }, (c) =>
      c.query(`GRANT USAGE, CREATE ON SCHEMA builds TO ${ddlRole}`),
    );
    return { config, app: { ...config, user: name, password: "app-secret" } };
  }

  const canCreateViaSetRole = (app: DbConfig, ddlRole: string) =>
    sqlState(withClient(app, (c) => c.query(`SET ROLE ${ddlRole}; CREATE TABLE builds.sneaky (id int)`)));

  // SET-only: NOINHERIT, and INHERIT FALSE on the grant, still allow SET ROLE.
  const setOnly = "WITH INHERIT FALSE, SET TRUE";

  it("revokes a SET-only membership the migrator can revoke as its grantor", async () => {
    const { config, app } = await setUp("albus_app_revocable", "ddl_revocable");
    await admin.query("GRANT ddl_revocable TO albus_migrate WITH ADMIN TRUE, INHERIT FALSE, SET FALSE");
    await admin.query(`GRANT ddl_revocable TO albus_app_revocable ${setOnly} GRANTED BY albus_migrate`);
    // The attack works before the rerun, so the test below proves the fix.
    expect(await canCreateViaSetRole(app, "ddl_revocable")).toBeUndefined();
    await withClient(app, (c) => c.query("SET ROLE ddl_revocable; DROP TABLE builds.sneaky"));

    await runMigrations(config, { appRole: { name: "albus_app_revocable", password: "app-secret" } });

    expect(await canCreateViaSetRole(app, "ddl_revocable")).toBe("42501");
  });

  it("fails closed on a membership from a grantor it can't act for", async () => {
    const { config, app } = await setUp("albus_app_stuck", "ddl_stuck");
    // Granted by the bootstrap superuser, which the migrator can't act for.
    await admin.query(`GRANT ddl_stuck TO albus_app_stuck ${setOnly}`);

    await expect(
      runMigrations(config, { appRole: { name: "albus_app_stuck", password: "app-secret" } }),
    ).rejects.toThrow(/still a member of ddl_stuck .*login has been disabled/);

    // 28000: role is not permitted to log in.
    expect(await canCreateViaSetRole(app, "ddl_stuck")).toBe("28000");
  });
});

describe("createClientDb", () => {
  let handle: ReturnType<typeof createDb>;
  let dbConfig: DbConfig;

  beforeAll(async () => {
    const config = await freshDatabase();
    await runMigrations(config);
    dbConfig = config;
    handle = createDb(config, { max: 1 });
  });

  afterAll(async () => {
    await handle?.pool.end();
  });

  /*
   * The pool holds one connection, so anything that took a second one would
   * hang here: the point of the handle is that it never does.
   */
  it("runs queries and transactions on one checked-out connection, session lock included", async () => {
    const client = await handle.pool.connect();
    const { db, close } = createClientDb(client);
    try {
      const { rows } = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(1, 1) AS locked");
      expect(rows[0]?.locked).toBe(true);

      const [tenant] = await db.insert(tenants).values({ name: "Held" }).returning({ id: tenants.id });
      const id = await db.transaction(async (tx) => {
        const [build] = await tx.insert(builds).values({ askText: "a sensor", tenantId: tenant!.id }).returning({ id: builds.id });
        await tx.insert(buildMessages).values({ buildId: build!.id, role: "user", text: "hello" });
        return build!.id;
      });
      expect(await db.select().from(buildMessages).where(eq(buildMessages.buildId, id))).toHaveLength(1);

      await client.query("SELECT pg_advisory_unlock(1, 1)");
    } finally {
      await close();
      client.release();
    }
  });

  it("close() fences the handle, so late work can't run on someone else's connection", async () => {
    const client = await handle.pool.connect();
    const { db, close } = createClientDb(client);
    await close();
    client.release();
    // Drizzle wraps it, so the reason is in the cause.
    await expect(db.select().from(tenants)).rejects.toMatchObject({ cause: { message: expect.stringContaining("closed with its connection") } });
  });

  /*
   * The case that matters for a handle sharing its connection with the work
   * that comes after it: a statement abandoned inside a transaction. Fencing
   * alone would leave the transaction open or aborted, and the next BEGIN on
   * the connection would fail (25P02) or silently join it.
   */
  it("close() drains an abandoned statement and rolls its transaction back, leaving the connection usable", async () => {
    const client = await handle.pool.connect();
    // Its own connection, not the pool's: the pool holds exactly one.
    const blocker = new pg.Client({ ...dbConfig, ssl: false });
    await blocker.connect();
    const { db, close } = createClientDb(client);
    const [tenant] = await db.insert(tenants).values({ name: "Abandoned" }).returning({ id: tenants.id });
    const [build] = await db.insert(builds).values({ askText: "a sensor", tenantId: tenant!.id }).returning({ id: builds.id });

    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM builds.builds WHERE id = $1 FOR UPDATE", [build!.id]);
    await client.query("SET statement_timeout = '300ms'");

    // Nobody waits for this: it is the query the deadline walked away from.
    const abandoned = db.transaction(async (tx) => {
      await tx.select().from(builds).where(eq(builds.id, build!.id)).for("update");
      await tx.insert(buildMessages).values({ buildId: build!.id, role: "user", text: "never committed" });
    });
    abandoned.catch(() => {});

    try {
      await close();
      await client.query("RESET statement_timeout");
      // The connection takes a new transaction, and the abandoned one left nothing behind.
      await client.query("BEGIN");
      const { rows } = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM builds.build_messages WHERE build_id = $1", [build!.id]);
      await client.query("COMMIT");
      expect(rows[0]?.n).toBe(0);
    } finally {
      await blocker.query("ROLLBACK");
      await blocker.end();
      client.release();
    }
  });
});
