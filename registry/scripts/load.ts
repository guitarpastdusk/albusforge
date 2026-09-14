/**
 * Loads the registry into `registry.parts` (ARCHITECTURE.md §16, M1). Run by the
 * `registry-load` Cloud Run Job as the app role, after `db-migrate`:
 *
 *   node registry/dist/load.js                   (the db-jobs image)
 *   pnpm --filter @albusforge/registry load      (locally, from source)
 *
 * 1. Validates the whole registry, exactly as `validate.ts` does. Any problem
 *    fails the run before the database is touched.
 * 2. Inserts every part version in one transaction. A version already in the
 *    table with the same definition is a no-op. A version already in the table
 *    with a different definition fails the whole run and inserts nothing:
 *    plans pin (id, version) forever (§5.1), so a changed part needs a new
 *    version.
 *
 * Rows are never updated or deleted. A part removed from disk stays in the
 * table, because old plans may still pin it.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { compatMatrix as compatTable, createDb, type Db, dbConfigFromEnv, parts as partsTable } from "@albusforge/db";
import type { PartDefinition } from "@albusforge/schema";
import { z } from "zod";
import { GOLDEN_BUILDS } from "./golden-builds";
import { loadRegistry } from "./lib/load";
import { readFileSync } from "node:fs";
import { formatIssues, validateRegistry } from "./lib/rules";

export interface LoadResult {
  /** `id@version`, sorted. */
  inserted: string[];
  unchanged: string[];
}

/**
 * A row of registry/compat-matrix.json: one driver build that is known to
 * compile against a runtime on a brain. ARCHITECTURE.md §22 has CI generating
 * these rows; until that matrix job exists the file is the seed the matcher's
 * compatibility constraint (apps/matcher/src/constraints.ts) reads through
 * registry.compat_matrix. Rows here are asserted, not produced by a compile;
 * see docs/DEMO-ASSUMPTIONS.md.
 */
export const CompatRow = z.strictObject({
  driver_pkg: z.string().regex(/^hsx-driver-[a-z0-9-]+$/, "expected hsx-driver-<name>"),
  driver_ver: z.string().min(1),
  runtime_ver: z.string().min(1),
  brain_id: z.string().regex(/^[VPLCME]-\d{3}$/, "expected a part id like C-002"),
  status: z.enum(["passed", "failed"]),
});
export type CompatRow = z.infer<typeof CompatRow>;

/** Reads and validates registry/compat-matrix.json. */
export function readCompatRows(root: string): CompatRow[] {
  const file = path.join(root, "compat-matrix.json");
  const parsed = z.array(CompatRow).safeParse(JSON.parse(readFileSync(file, "utf8")));
  if (!parsed.success) {
    throw new RegistryInvalidError(
      parsed.error.issues.map((i) => `  compat-matrix.json\n    [schema] ${i.path.join(".")}: ${i.message}`).join("\n"),
    );
  }
  return parsed.data;
}

/** Inserts the compat rows; an identical row already present is a no-op. */
export async function loadCompat(db: Db, rows: readonly CompatRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const inserted = await db
    .insert(compatTable)
    .values(rows.map((r) => ({
      driverPkg: r.driver_pkg,
      driverVer: r.driver_ver,
      runtimeVer: r.runtime_ver,
      brainId: r.brain_id,
      status: r.status,
    })))
    .onConflictDoNothing()
    .returning({ driverPkg: compatTable.driverPkg });
  return inserted.length;
}

/** An (id, version) already in the table with a different definition. */
export class ImmutableVersionError extends Error {
  constructor(readonly versions: string[]) {
    super(
      `registry.parts already has ${versions.join(", ")} with a different definition. ` +
        "Part versions are immutable: bump the version instead of editing a loaded one.",
    );
    this.name = "ImmutableVersionError";
  }
}

export class RegistryInvalidError extends Error {
  constructor(readonly report: string) {
    super(`registry is invalid; nothing was loaded:\n${report}`);
    this.name = "RegistryInvalidError";
  }
}

const key = (row: { id: string; version: string }) => `${row.id}@${row.version}`;

/**
 * JSON with object keys sorted, so two definitions compare equal whatever order
 * their keys are in. jsonb doesn't keep key order.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, current: unknown) => {
    if (current === null || typeof current !== "object" || Array.isArray(current)) return current;
    return Object.fromEntries(Object.entries(current).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  });
}

/** What's stored: the parsed definition, without the editor-only `$schema` hint. */
function toRow(part: PartDefinition) {
  const { $schema: _hint, ...definition } = part;
  void _hint;
  return { id: part.id, version: part.version, status: part.status, definition };
}

/** Parses and validates the registry on disk; throws RegistryInvalidError on any problem. */
export function readValidatedParts(root: string): PartDefinition[] {
  const { issues, parts } = validateRegistry({ ...loadRegistry(root), goldenBuilds: GOLDEN_BUILDS });
  if (issues.length > 0) throw new RegistryInvalidError(formatIssues(issues));
  return parts.map((p) => p.part);
}

export async function loadParts(db: Db, parts: readonly PartDefinition[]): Promise<LoadResult> {
  const rows = parts.map(toRow);
  if (rows.length === 0) return { inserted: [], unchanged: [] };

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(partsTable)
      .values(rows)
      .onConflictDoNothing()
      .returning({ id: partsTable.id, version: partsTable.version });
    const insertedKeys = new Set(inserted.map(key));

    const existing = rows.filter((row) => !insertedKeys.has(key(row)));
    const unchanged: string[] = [];
    const changed: string[] = [];
    if (existing.length > 0) {
      const ids = [...new Set(existing.map((row) => row.id))];
      const stored = await tx.query.parts.findMany({ where: (t, { inArray }) => inArray(t.id, ids) });
      const storedByKey = new Map(stored.map((row) => [key(row), row]));
      for (const row of existing) {
        const current = storedByKey.get(key(row));
        const same =
          current !== undefined &&
          current.status === row.status &&
          canonicalJson(current.definition) === canonicalJson(row.definition);
        (same ? unchanged : changed).push(key(row));
      }
    }

    // Throwing rolls the transaction back, so the rows inserted above go too.
    if (changed.length > 0) throw new ImmutableVersionError(changed.sort());
    return { inserted: [...insertedKeys].sort(), unchanged: unchanged.sort() };
  });
}

/** One JSON object per line, in the shape Cloud Logging parses from a Cloud Run Job. */
function jsonLog(severity: "INFO" | "ERROR", message: string, fields?: Record<string, unknown>): void {
  console.log(JSON.stringify({ severity, message, ...fields }));
}

async function main(): Promise<void> {
  // registry/, from scripts/ when run from source and from dist/ when bundled.
  const root = path.resolve(import.meta.dirname, "..");
  const parts = readValidatedParts(root);

  const config = dbConfigFromEnv();
  // Never the password: only where and as whom.
  jsonLog("INFO", "registry load starting", {
    host: config.host,
    database: config.database,
    user: config.user,
    parts: parts.length,
  });

  const compat = readCompatRows(root);
  const { db, pool } = createDb(config, { max: 1 });
  try {
    const result = await loadParts(db, parts);
    const compatInserted = await loadCompat(db, compat);
    jsonLog("INFO", "registry load complete", { ...result, compat_inserted: compatInserted });
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    jsonLog("ERROR", "registry load failed", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exitCode = 1;
  });
}
