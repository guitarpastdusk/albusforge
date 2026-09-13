import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDb, type DbConfig, parts as partsTable } from "@albusforge/db";
import { runMigrations } from "@albusforge/db/migrate";
import type { PartDefinition } from "@albusforge/schema";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { REGISTRY_ROOT } from "../scripts/lib/load";
import {
  canonicalJson,
  ImmutableVersionError,
  loadParts,
  readValidatedParts,
  RegistryInvalidError,
} from "../scripts/load";

const committed = readValidatedParts(REGISTRY_ROOT);
const byId = (id: string) => structuredClone(committed.find((p) => p.id === id)!);

describe("readValidatedParts", () => {
  it("reads the twelve committed parts", () => {
    expect(committed).toHaveLength(12);
  });

  it("refuses a registry with any problem", () => {
    const root = mkdtempSync(path.join(tmpdir(), "registry-"));
    try {
      cpSync(REGISTRY_ROOT, root, {
        recursive: true,
        filter: (src) => !src.includes("node_modules") && !src.includes(`${path.sep}dist`),
      });
      writeFileSync(path.join(root, "parts/P-001/part.json"), "{ not json");
      expect(() => readValidatedParts(root)).toThrow(RegistryInvalidError);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("canonicalJson", () => {
  it("ignores key order but not array order", () => {
    expect(canonicalJson({ a: 1, b: { c: [1, 2], d: null } })).toBe(canonicalJson({ b: { d: null, c: [1, 2] }, a: 1 }));
    expect(canonicalJson({ a: [1, 2] })).not.toBe(canonicalJson({ a: [2, 1] }));
  });
});

describe("loadParts", () => {
  let container: StartedPostgreSqlContainer;
  let admin: pg.Client;
  let databases = 0;
  let handle: ReturnType<typeof createDb>;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
    admin = new pg.Client({ connectionString: container.getConnectionUri() });
    await admin.connect();
    await admin.query("CREATE ROLE albus_migrate LOGIN CREATEROLE PASSWORD 'migrate-secret'");
  });

  afterAll(async () => {
    await admin?.end();
    await container?.stop();
  });

  // A fresh database per test, migrated as albus_migrate; the loader connects as albus_app, as the Job does.
  beforeEach(async () => {
    const database = `registry_${++databases}`;
    await admin.query(`CREATE DATABASE ${database} OWNER albus_migrate`);
    const base: DbConfig = {
      host: container.getHost(),
      port: container.getPort(),
      database,
      user: "albus_migrate",
      password: "migrate-secret",
      ssl: "disable",
    };
    await runMigrations(base, { appRole: { name: "albus_app", password: "app-secret" } });
    handle = createDb({ ...base, user: "albus_app", password: "app-secret" }, { max: 2 });
    return () => handle.pool.end();
  });

  const stored = () => handle.db.select().from(partsTable);

  it("inserts every committed part version as the app role", async () => {
    const result = await loadParts(handle.db, committed);

    expect(result.inserted).toHaveLength(12);
    expect(result.unchanged).toEqual([]);
    const rows = await stored();
    expect(rows.map((r) => `${r.id}@${r.version}`).sort()).toEqual(result.inserted);
    const p001 = rows.find((r) => r.id === "P-001")!;
    expect(p001.status).toBe("draft");
    // Stored without the editor-only $schema hint.
    expect(p001.definition).not.toHaveProperty("$schema");
    expect(canonicalJson(p001.definition)).toBe(canonicalJson({ ...byId("P-001"), $schema: undefined }));
  });

  it("is a no-op when run again", async () => {
    await loadParts(handle.db, committed);
    const before = await stored();

    const result = await loadParts(handle.db, committed);

    expect(result.inserted).toEqual([]);
    expect(result.unchanged).toHaveLength(12);
    const after = await stored();
    expect(after.map((r) => r.loadedAt.toISOString()).sort()).toEqual(before.map((r) => r.loadedAt.toISOString()).sort());
  });

  it("treats a definition with reordered keys as identical", async () => {
    await loadParts(handle.db, committed);
    const part = byId("P-002");
    const reordered = Object.fromEntries(Object.entries(part).reverse()) as PartDefinition;

    expect(await loadParts(handle.db, [reordered])).toEqual({ inserted: [], unchanged: ["P-002@1.0.0"] });
  });

  it("fails loudly on an existing version with a different definition, and loads nothing", async () => {
    await loadParts(handle.db, [byId("P-001"), byId("P-002")]);
    const edited = byId("P-001");
    edited.name = "BME280, renamed without a version bump";
    const alsoEdited = byId("P-002");
    alsoEdited.electrical.current_draw_ma.active = 99;

    const attempt = loadParts(handle.db, [byId("V-005"), edited, alsoEdited]);

    await expect(attempt).rejects.toThrow(ImmutableVersionError);
    await expect(attempt).rejects.toThrow(/P-001@1\.0\.0, P-002@1\.0\.0 with a different definition/);
    // V-005 was new, but the whole transaction rolled back.
    const rows = await stored();
    expect(rows.map((r) => r.id).sort()).toEqual(["P-001", "P-002"]);
    expect(rows.find((r) => r.id === "P-001")?.definition).toMatchObject({ name: byId("P-001").name });
  });

  it("adds a new version of an existing part alongside the old one", async () => {
    await loadParts(handle.db, committed);
    const next = byId("P-001");
    next.version = "1.1.0";
    next.name = "BME280, revised";

    expect(await loadParts(handle.db, [byId("P-001"), next])).toEqual({
      inserted: ["P-001@1.1.0"],
      unchanged: ["P-001@1.0.0"],
    });
    expect((await stored()).filter((r) => r.id === "P-001").map((r) => r.version).sort()).toEqual(["1.0.0", "1.1.0"]);
  });
});
