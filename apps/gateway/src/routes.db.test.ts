/*
 * The routes against a real Postgres: migrate with @albusforge/db, load the
 * committed registry with the registry loader as the app role, then query
 * through the gateway exactly as the server wires it.
 */
import { createDb, type DbConfig } from "@albusforge/db";
import { runMigrations } from "@albusforge/db/migrate";
import { loadParts, readValidatedParts } from "@albusforge/registry/db-load";
import { REGISTRY_ROOT } from "@albusforge/registry/load";
import { type PartDefinition, PartDetail, PartList } from "@albusforge/schema";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app";
import { createLogger } from "./log";
import { createPartsStore } from "./parts";

const registry = readValidatedParts(REGISTRY_ROOT);

function variant(id: string, changes: Partial<PartDefinition>): PartDefinition {
  return { ...structuredClone(registry.find((p) => p.id === id)!), ...changes };
}

let container: StartedPostgreSqlContainer;
let handle: ReturnType<typeof createDb>;
let app: FastifyInstance;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").withTmpFs({ "/var/lib/postgresql/data": "rw,size=256m" }).start();
  const admin = new pg.Client({ connectionString: container.getConnectionUri() });
  await admin.connect();
  await admin.query("CREATE ROLE albus_migrate LOGIN CREATEROLE PASSWORD 'migrate-secret'");
  await admin.query("CREATE DATABASE albus OWNER albus_migrate");
  await admin.end();

  const migrate: DbConfig = {
    host: container.getHost(),
    port: container.getPort(),
    database: "albus",
    user: "albus_migrate",
    password: "migrate-secret",
    ssl: "disable",
  };
  await runMigrations(migrate, { appRole: { name: "albus_app", password: "app-secret" } });

  handle = createDb({ ...migrate, user: "albus_app", password: "app-secret" }, { max: 2 });
  await loadParts(handle.db, registry);
  // Extra versions, as later registry changes would add them.
  await loadParts(handle.db, [
    variant("P-001", { version: "1.9.0" }),
    variant("P-001", { version: "1.10.0", name: "BME280 v1.10" }),
    variant("E-005", { version: "1.0.1-rc.1" }),
    // E-005 is complete enough to pass the non-draft checks.
    variant("E-005", { version: "1.1.0", status: "retired" }),
  ]);

  app = buildApp({
    parts: createPartsStore(handle.db),
    ping: async () => void (await handle.pool.query("SELECT 1")),
    log: createLogger({ write: () => {} }),
  });
});

afterAll(async () => {
  await app?.close();
  await handle?.pool.end();
  await container?.stop();
});

const get = async (url: string) => {
  const response = await app.inject({ method: "GET", url });
  return { status: response.statusCode, body: response.json() };
};

describe("against Postgres", () => {
  it("/readyz pings the database", async () => {
    expect((await get("/readyz")).status).toBe(200);
  });

  it("lists the latest non-retired version of every part by SemVer", async () => {
    const { status, body } = await get("/v1/parts");
    expect(status).toBe(200);
    const list = PartList.parse(body);
    expect(list.parts.map((p) => p.id)).toEqual(registry.map((p) => p.id).sort());
    const versions = Object.fromEntries(list.parts.map((p) => [p.id, p.version]));
    // 1.10.0 over 1.9.0; the retired 1.1.0 is filtered out, leaving the pre-release over 1.0.0.
    expect(versions["P-001"]).toBe("1.10.0");
    expect(versions["E-005"]).toBe("1.0.1-rc.1");
    expect(list.parts.find((p) => p.id === "P-001")?.name).toBe("BME280 v1.10");
  });

  it("filters by status and category", async () => {
    expect(PartList.parse((await get("/v1/parts?status=retired")).body).parts.map((p) => `${p.id}@${p.version}`)).toEqual([
      "E-005@1.1.0",
    ]);
    expect(PartList.parse((await get("/v1/parts?status=active")).body).parts).toEqual([]);
    expect(PartList.parse((await get("/v1/parts?category=energy")).body).parts.map((p) => p.id)).toEqual([
      "E-001",
      "E-004",
      "E-005",
    ]);
  });

  it("returns one part with every block", async () => {
    const { status, body } = await get("/v1/parts/P-001");
    expect(status).toBe(200);
    const { part } = PartDetail.parse(body);
    expect(part.version).toBe("1.10.0");
    expect(part.electrical.i2c_address).toBe("0x77");

    expect(PartDetail.parse((await get("/v1/parts/E-005?status=retired,draft")).body).part.version).toBe("1.1.0");
    expect((await get("/v1/parts/P-003")).status).toBe(404);
  });
});
