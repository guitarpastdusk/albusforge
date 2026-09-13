/**
 * Writes registry/schemas/*.schema.json from the zod schemas in
 * packages/schema (ARCHITECTURE.md §4: "exported as JSON Schema"). The JSON
 * files are for editors and non-TypeScript consumers; zod stays the source of
 * truth, and cross-field rules (`deprecated` needs a successor, min ≤ max)
 * exist only there.
 *
 *   tsx scripts/schemas.ts           rewrite the files
 *   tsx scripts/schemas.ts --check   exit 1 if a committed file is stale
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ConnectorDefinition, PartDefinition } from "@albusforge/schema";
import { REGISTRY_ROOT } from "./lib/load";

function render(schema: z.ZodType, title: string): string {
  const json = z.toJSONSchema(schema, { target: "draft-2020-12", io: "input" });
  return `${JSON.stringify({ title, ...json }, null, 2)}\n`;
}

/** File name under registry/schemas/ → contents. */
export function generateSchemas(): Record<string, string> {
  return {
    "part.schema.json": render(PartDefinition, "Albus Forge Part Definition"),
    "connector.schema.json": render(ConnectorDefinition, "Albus Forge Connector Definition"),
  };
}

function readOrEmpty(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  const stale: string[] = [];
  for (const [name, contents] of Object.entries(generateSchemas())) {
    const file = path.join(REGISTRY_ROOT, "schemas", name);
    if (readOrEmpty(file) === contents) continue;
    if (check) stale.push(name);
    else writeFileSync(file, contents);
  }
  if (stale.length > 0) {
    console.error(`registry/schemas is stale: ${stale.join(", ")}\nrun: pnpm --filter @albusforge/registry schemas`);
    process.exit(1);
  }
}
