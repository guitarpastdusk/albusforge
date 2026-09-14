import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PartDefinition } from "@albusforge/schema";

/** registry/, wherever this checkout lives. */
export const REGISTRY_ROOT = path.resolve(import.meta.dirname, "../..");

/** A JSON file as read from disk, before any validation. */
export interface RawFile {
  /** Path relative to the registry root, for error messages. */
  path: string;
  /** The part's folder name, or the connector file's name without `.json`. */
  name: string;
  data: unknown;
  /** Set when the file isn't valid JSON; `data` is then undefined. */
  parseError?: string;
}

export interface RawRegistry {
  parts: RawFile[];
  connectors: RawFile[];
  i2cShared: RawFile;
  knownIssues: RawFile;
  footprintExists: (partDir: string, footprintFile: string) => boolean;
}

function readJson(root: string, rel: string, name: string): RawFile {
  try {
    return { path: rel, name, data: JSON.parse(readFileSync(path.join(root, rel), "utf8")) };
  } catch (err) {
    return { path: rel, name, data: undefined, parseError: err instanceof Error ? err.message : String(err) };
  }
}

/** Reads every part.json and connector from disk, sorted by name so output is stable. */
export function loadRegistry(root: string = REGISTRY_ROOT): RawRegistry {
  const partDirs = readdirSync(path.join(root, "parts"), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const connectorFiles = readdirSync(path.join(root, "connectors"))
    .filter((f) => f.endsWith(".json"))
    .sort();

  // A part id may have more than one live version (a draft that is already
  // loaded into registry.parts, plus the promoted version a build pins).
  // `part.json` is the base version; `versions/<semver>.json` holds any other.
  // Part versions are immutable once loaded (scripts/load.ts), so promoting a
  // part means adding a file here, never editing the loaded one.
  const partFiles = partDirs.flatMap((dir) => {
    const versionsDir = path.join(root, "parts", dir, "versions");
    const extra = existsSync(versionsDir)
      ? readdirSync(versionsDir)
          .filter((f) => f.endsWith(".json"))
          .sort()
          .map((f) => `parts/${dir}/versions/${f}`)
      : [];
    return [`parts/${dir}/part.json`, ...extra].map((rel) => readJson(root, rel, dir));
  });

  return {
    parts: partFiles,
    connectors: connectorFiles.map((f) => readJson(root, `connectors/${f}`, f.slice(0, -".json".length))),
    i2cShared: readJson(root, "i2c-shared.json", "i2c-shared"),
    knownIssues: readJson(root, "known-issues.json", "known-issues"),
    footprintExists: (partDir, footprintFile) => existsSync(path.join(root, "parts", partDir, footprintFile)),
  };
}

/**
 * The parsed parts, for consumers that trust the registry has already passed
 * `validate.ts` (the catalogue, later the DB loader). Throws on the first
 * invalid part rather than returning a partial menu.
 */
export function loadParts(root: string = REGISTRY_ROOT): PartDefinition[] {
  return loadRegistry(root).parts.map((file) => {
    if (file.parseError) throw new Error(`${file.path}: ${file.parseError}`);
    const result = PartDefinition.safeParse(file.data);
    if (!result.success) throw new Error(`${file.path}: invalid part; run pnpm --filter @albusforge/registry validate`);
    return result.data;
  });
}
