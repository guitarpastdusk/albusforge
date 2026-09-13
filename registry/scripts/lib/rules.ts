import { z } from "zod";
import { ConnectorDefinition, I2cAddress, PartDefinition, PartId } from "@albusforge/schema";
import type { GoldenBuild } from "../golden-builds";
import type { RawFile } from "./load";
import { capabilityUnit } from "./units";

/**
 * Parts that deliberately share a default I²C address, with why that's fine
 * (for example, a solder jumper moves one of them). registry/i2c-shared.json.
 */
export const I2cShared = z.array(
  z.strictObject({
    address: I2cAddress,
    parts: z.array(PartId).min(2),
    note: z.string().min(1),
  }),
);
export type I2cShared = z.infer<typeof I2cShared>;

export type RuleId =
  | "json"
  | "schema"
  | "folder-id"
  | "connector-name"
  | "duplicate-version"
  | "footprint"
  | "connector-unknown"
  | "connector-interface"
  | "successor-unknown"
  | "conflict-unknown"
  | "requires-unprovided"
  | "capability-unit"
  | "i2c-clash"
  | "golden-build";

export interface RegistryIssue {
  rule: RuleId;
  file: string;
  message: string;
}

export interface RegistryInput {
  parts: RawFile[];
  connectors: RawFile[];
  i2cShared: RawFile;
  footprintExists: (partDir: string, footprintFile: string) => boolean;
  goldenBuilds: readonly GoldenBuild[];
}

export interface RegistryResult {
  issues: RegistryIssue[];
  /** Parts that passed the schema, whether or not cross-part rules passed. */
  parts: { file: RawFile; part: PartDefinition }[];
  connectors: ConnectorDefinition[];
}

/** Parts the matcher may still pick, or that other parts may still lean on. */
const LIVE = new Set(["draft", "active"]);

function parseFile<T>(
  file: RawFile,
  schema: z.ZodType<T>,
  issues: RegistryIssue[],
): T | undefined {
  if (file.parseError !== undefined) {
    issues.push({ rule: "json", file: file.path, message: `not valid JSON: ${file.parseError}` });
    return undefined;
  }
  const result = schema.safeParse(file.data);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const where = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      issues.push({ rule: "schema", file: file.path, message: `${where}: ${issue.message}` });
    }
    return undefined;
  }
  return result.data;
}

/**
 * Every rule the registry holds itself to. Pure: disk access is in load.ts,
 * so each rule is testable against an in-memory fixture.
 */
export function validateRegistry(input: RegistryInput): RegistryResult {
  const issues: RegistryIssue[] = [];

  const connectors: ConnectorDefinition[] = [];
  for (const file of input.connectors) {
    const connector = parseFile(file, ConnectorDefinition, issues);
    if (!connector) continue;
    if (connector.id !== file.name) {
      issues.push({ rule: "connector-name", file: file.path, message: `id "${connector.id}" must match the file name "${file.name}.json"` });
    }
    connectors.push(connector);
  }
  const connectorsById = new Map(connectors.map((c) => [c.id, c]));

  const parts: RegistryResult["parts"] = [];
  const seenVersions = new Map<string, string>();
  for (const file of input.parts) {
    const part = parseFile(file, PartDefinition, issues);
    if (!part) continue;
    parts.push({ file, part });

    if (part.id !== file.name) {
      issues.push({ rule: "folder-id", file: file.path, message: `id "${part.id}" must match its folder "parts/${file.name}"` });
    }

    const key = `${part.id}@${part.version}`;
    const firstSeen = seenVersions.get(key);
    if (firstSeen !== undefined) {
      issues.push({ rule: "duplicate-version", file: file.path, message: `${key} is already defined in ${firstSeen}` });
    } else {
      seenVersions.set(key, file.path);
    }

    // §7.5: the validator confirms the footprint exists. Drafts wait for the fit spike.
    if ((part.status === "active" || part.status === "deprecated") && !input.footprintExists(file.name, part.mechanical.footprint_file)) {
      issues.push({
        rule: "footprint",
        file: file.path,
        message: `status "${part.status}" needs parts/${file.name}/${part.mechanical.footprint_file} to exist; keep the part a draft until it does`,
      });
    }

    const connector = connectorsById.get(part.electrical.connector);
    if (!connector) {
      issues.push({ rule: "connector-unknown", file: file.path, message: `connector "${part.electrical.connector}" has no file in connectors/` });
    } else if (!connector.interfaces.includes(part.electrical.interface)) {
      issues.push({
        rule: "connector-interface",
        file: file.path,
        message: `connector "${connector.id}" doesn't carry interface "${part.electrical.interface}" (it carries ${connector.interfaces.join(", ")})`,
      });
    }

    for (const cap of part.software.capabilities) {
      if (capabilityUnit(cap) === undefined) {
        issues.push({ rule: "capability-unit", file: file.path, message: `capability "${cap}" needs a unit suffix (_c, _pct, …; see scripts/lib/units.ts)` });
      }
    }
  }

  const knownIds = new Set(parts.map((p) => p.part.id));
  const live = parts.filter((p) => LIVE.has(p.part.status));
  const provided = new Map<string, string[]>();
  for (const { part } of live) {
    for (const cap of part.software.capabilities) {
      provided.set(cap, [...(provided.get(cap) ?? []), part.id]);
    }
  }

  for (const { file, part } of parts) {
    if (part.successor !== null && !knownIds.has(part.successor)) {
      issues.push({ rule: "successor-unknown", file: file.path, message: `successor "${part.successor}" is not a part in the registry` });
    }
    for (const id of part.electrical.conflicts) {
      if (!knownIds.has(id)) {
        issues.push({ rule: "conflict-unknown", file: file.path, message: `conflicts lists "${id}", which is not a part in the registry` });
      }
    }
    if (!LIVE.has(part.status)) continue;
    for (const need of part.electrical.requires) {
      if (!provided.has(need)) {
        issues.push({ rule: "requires-unprovided", file: file.path, message: `requires "${need}", which no draft or active part provides` });
      }
    }
  }

  const shared = parseFile(input.i2cShared, I2cShared, issues) ?? [];
  const byAddress = new Map<string, string[]>();
  for (const { part } of live) {
    const address = part.electrical.i2c_address;
    if (address === null) continue;
    const ids = byAddress.get(address) ?? [];
    if (!ids.includes(part.id)) ids.push(part.id);
    byAddress.set(address, ids);
  }
  for (const [address, ids] of byAddress) {
    if (ids.length < 2) continue;
    const noted = shared.some((entry) => entry.address === address && ids.every((id) => entry.parts.includes(id)));
    if (!noted) {
      issues.push({
        rule: "i2c-clash",
        file: input.i2cShared.path,
        message: `${ids.join(", ")} all default to I2C address ${address}; add an entry saying why that's safe, or change one part`,
      });
    }
  }
  for (const entry of shared) {
    const ids = byAddress.get(entry.address) ?? [];
    if (!entry.parts.every((id) => ids.includes(id))) {
      issues.push({
        rule: "i2c-clash",
        file: input.i2cShared.path,
        message: `entry for ${entry.address} lists ${entry.parts.join(", ")}, but they don't all default to that address any more`,
      });
    }
  }

  for (const build of input.goldenBuilds) {
    for (const cap of [...build.requires, ...build.optional]) {
      if (!provided.has(cap)) {
        issues.push({ rule: "golden-build", file: "scripts/golden-builds.ts", message: `${build.name} needs "${cap}", which no draft or active part provides` });
      }
    }
  }

  return { issues, parts, connectors };
}

export function formatIssues(issues: readonly RegistryIssue[]): string {
  return issues.map((i) => `  ${i.file}\n    [${i.rule}] ${i.message}`).join("\n");
}
