import type { Db } from "@albusforge/db";
import { compareSemver } from "@albusforge/registry/semver";
import { type PartCategory, PartDefinition, type PartStatus } from "@albusforge/schema";

export interface PartFilter {
  statuses: readonly PartStatus[];
  category?: PartCategory;
  id?: string;
}

/** Reads `registry.parts`. Behind an interface so route tests can run without Postgres. */
export interface PartsStore {
  /** The highest SemVer version of each matching id, sorted by id. */
  latest(filter: PartFilter): Promise<PartDefinition[]>;
}

interface VersionRow {
  id: string;
  version: string;
}

/**
 * Keeps the highest SemVer version per id, using the registry's comparator
 * (numeric, pre-releases below their release), never string order.
 */
export function latestPerId<T extends VersionRow>(rows: readonly T[]): T[] {
  const latest = new Map<string, T>();
  for (const row of rows) {
    const current = latest.get(row.id);
    if (!current || compareSemver(row.version, current.version) > 0) latest.set(row.id, row);
  }
  return [...latest.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** A stored definition that no longer parses is a server error, not something to serve. */
export class StoredPartInvalidError extends Error {
  constructor(row: VersionRow, cause: unknown) {
    super(`registry.parts ${row.id}@${row.version} does not match the Part Definition schema`, { cause });
    this.name = "StoredPartInvalidError";
  }
}

export function createPartsStore(db: Db): PartsStore {
  return {
    async latest({ statuses, category, id }) {
      if (statuses.length === 0) return [];
      const rows = await db.query.parts.findMany({
        columns: { id: true, version: true, definition: true },
        where: (t, { and, eq, inArray }) => and(inArray(t.status, [...statuses]), id === undefined ? undefined : eq(t.id, id)),
      });
      return latestPerId(rows)
        .map((row) => {
          const parsed = PartDefinition.safeParse(row.definition);
          if (!parsed.success) throw new StoredPartInvalidError(row, parsed.error);
          return parsed.data;
        })
        .filter((part) => category === undefined || part.category === category);
    },
  };
}
