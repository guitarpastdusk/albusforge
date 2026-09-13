import { type Db } from "@albusforge/db";
import { buildCatalogue, renderCatalogue } from "@albusforge/registry/catalogue";
import { PartDefinition, type PartStatus } from "@albusforge/schema";
import type { Vocabulary } from "./decide";

/**
 * The part catalogue: the cached prompt context and the vocabulary specs are
 * checked against. Read from `registry.parts` (loaded by the registry-load
 * job), active parts only unless drafts are included. Rendering is
 * deterministic, so the prompt prefix is byte-identical until the registry changes.
 */

export interface CatalogueSnapshot {
  text: string;
  vocabulary: Vocabulary;
  partCount: number;
}

/**
 * `db` is the caller's own connection: a turn holds one for its advisory lock
 * and must not take a second from the pool (handler.ts). Sources that don't
 * read the database ignore it.
 */
export type PartsSource = (statuses: readonly PartStatus[], db?: Db) => Promise<PartDefinition[]>;

export function dbPartsSource(): PartsSource {
  return async (statuses, db) => {
    if (statuses.length === 0) return [];
    if (!db) throw new Error("dbPartsSource needs the caller's database handle");
    const rows = await db.query.parts.findMany({
      columns: { id: true, version: true, definition: true },
      where: (t, { inArray }) => inArray(t.status, [...statuses]),
    });
    return rows.map((row) => {
      const parsed = PartDefinition.safeParse(row.definition);
      if (!parsed.success) throw new Error(`registry.parts ${row.id}@${row.version} does not match the Part Definition schema`);
      return parsed.data;
    });
  };
}

export function snapshotFrom(parts: readonly PartDefinition[], statuses: readonly PartStatus[]): CatalogueSnapshot {
  const catalogue = buildCatalogue(parts, { statuses });
  return {
    text: renderCatalogue(catalogue),
    vocabulary: {
      capabilities: new Set(catalogue.capabilities.map((c) => c.capability)),
      environmentFlags: new Set(catalogue.environment_flags),
    },
    partCount: catalogue.parts.length,
  };
}

export interface CatalogueCache {
  /** Pass the caller's handle: a refresh reads the registry on it. */
  get(db?: Db): Promise<CatalogueSnapshot>;
}

export interface CatalogueCacheOptions {
  source: PartsSource;
  includeDrafts: boolean;
  /** How long a snapshot is reused before the registry is read again. */
  ttlMs?: number;
  now?: () => number;
  onLoad?: (snapshot: CatalogueSnapshot) => void;
}

export function catalogueStatuses(includeDrafts: boolean): PartStatus[] {
  return includeDrafts ? ["active", "draft"] : ["active"];
}

export function createCatalogueCache({ source, includeDrafts, ttlMs = 10 * 60_000, now = Date.now, onLoad }: CatalogueCacheOptions): CatalogueCache {
  const statuses = catalogueStatuses(includeDrafts);
  let cached: { snapshot: CatalogueSnapshot; at: number } | undefined;
  let loading: Promise<CatalogueSnapshot> | undefined;
  return {
    async get(db) {
      if (cached && now() - cached.at < ttlMs) return cached.snapshot;
      loading ??= source(statuses, db)
        .then((parts) => {
          const snapshot = snapshotFrom(parts, statuses);
          cached = { snapshot, at: now() };
          onLoad?.(snapshot);
          return snapshot;
        })
        .finally(() => {
          loading = undefined;
        });
      return loading;
    },
  };
}
