import type { PartDefinition, PartStatus } from "@albusforge/schema";
import { compareSemver } from "./lib/semver";
import { capabilityUnit } from "./lib/units";

/**
 * The compact part catalogue intake puts in its cached prompt prefix
 * (ASK-TO-ENCLOSURE.md §3): capabilities with units, environment flags, power
 * options, and one line per part. Pure and deterministic — same parts in any
 * order give byte-identical output — because anything volatile in the prefix
 * turns every cache read into a cache write.
 */

export interface CatalogueOptions {
  /** Which statuses to include. Defaults to active only: drafts aren't on the menu. */
  statuses?: readonly PartStatus[];
}

export interface CatalogueCapability {
  capability: string;
  unit: string | null;
  parts: string[];
}

export interface CataloguePowerOption {
  id: string;
  name: string;
  provides: string[];
  output_v: [number, number];
  max_output_ma: number;
  capacity_mah: number | null;
}

export interface CataloguePart {
  id: string;
  version: string;
  name: string;
  category: PartDefinition["category"];
  provides: string[];
  requires: string[];
  voltage_range: [number, number];
  current_draw_ma: { idle: number; active: number };
  exposure: PartDefinition["mechanical"]["exposure"];
  environment_flags: string[];
}

export interface Catalogue {
  capabilities: CatalogueCapability[];
  environment_flags: string[];
  power_options: CataloguePowerOption[];
  parts: CataloguePart[];
}

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sorted = (xs: readonly string[]) => [...new Set(xs)].sort(byString);

export function buildCatalogue(parts: readonly PartDefinition[], options: CatalogueOptions = {}): Catalogue {
  const statuses = new Set<string>(options.statuses ?? ["active"]);

  // One entry per id: the highest included version.
  const latest = new Map<string, PartDefinition>();
  for (const part of parts) {
    if (!statuses.has(part.status)) continue;
    const current = latest.get(part.id);
    if (!current || compareSemver(part.version, current.version) > 0) latest.set(part.id, part);
  }
  const chosen = [...latest.values()].sort((a, b) => byString(a.id, b.id));

  const providers = new Map<string, string[]>();
  for (const part of chosen) {
    for (const cap of part.software.capabilities) providers.set(cap, [...(providers.get(cap) ?? []), part.id]);
  }

  return {
    capabilities: sorted([...providers.keys()]).map((capability) => ({
      capability,
      unit: capabilityUnit(capability) ?? null,
      parts: sorted(providers.get(capability) ?? []),
    })),
    environment_flags: sorted(chosen.flatMap((p) => p.mechanical.environment_flags)),
    // Energy parts only: the host's regulated rail is not a way to power a build.
    power_options: chosen.flatMap((p) =>
      p.category === "energy" && p.electrical.supply
        ? [
            {
              id: p.id,
              name: p.name,
              provides: sorted(p.software.capabilities.filter((c) => c.startsWith("power."))),
              output_v: p.electrical.supply.output_v,
              max_output_ma: p.electrical.supply.max_output_ma,
              capacity_mah: p.electrical.supply.capacity_mah,
            },
          ]
        : [],
    ),
    parts: chosen.map((p) => ({
      id: p.id,
      version: p.version,
      name: p.name,
      category: p.category,
      provides: sorted(p.software.capabilities),
      requires: sorted(p.electrical.requires),
      voltage_range: p.electrical.voltage_range,
      current_draw_ma: { idle: p.electrical.current_draw_ma.idle, active: p.electrical.current_draw_ma.active },
      exposure: p.mechanical.exposure,
      environment_flags: sorted(p.mechanical.environment_flags),
    })),
  };
}

const list = (xs: readonly string[]) => (xs.length > 0 ? xs.join(", ") : "none");

/** The catalogue as prompt text. */
export function renderCatalogue(catalogue: Catalogue): string {
  const lines: string[] = ["# Part catalogue", "", "## Capabilities (capability [unit]: parts)"];
  for (const c of catalogue.capabilities) {
    lines.push(`- ${c.capability}${c.unit ? ` [${c.unit}]` : ""}: ${c.parts.join(", ")}`);
  }
  lines.push("", "## Environment flags", `- ${list(catalogue.environment_flags)}`);
  lines.push("", "## Power options (id name: provides; output; max current; capacity)");
  for (const p of catalogue.power_options) {
    const capacity = p.capacity_mah === null ? "no storage" : `${p.capacity_mah} mAh`;
    lines.push(`- ${p.id} ${p.name}: ${list(p.provides)}; ${p.output_v[0]}–${p.output_v[1]} V; ${p.max_output_ma} mA; ${capacity}`);
  }
  lines.push("", "## Parts (id@version name | category | provides | requires | supply V | idle/active mA | exposure | flags)");
  for (const p of catalogue.parts) {
    lines.push(
      [
        `- ${p.id}@${p.version} ${p.name}`,
        p.category,
        list(p.provides),
        list(p.requires),
        `${p.voltage_range[0]}–${p.voltage_range[1]} V`,
        `${p.current_draw_ma.idle}/${p.current_draw_ma.active} mA`,
        p.exposure,
        list(p.environment_flags),
      ].join(" | "),
    );
  }
  return `${lines.join("\n")}\n`;
}
