import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REGISTRY_ROOT } from "../scripts/lib/load";
import { generateSchemas } from "../scripts/schemas";

describe("registry/schemas", () => {
  it.each(Object.entries(generateSchemas()))("%s matches the zod schema (run `pnpm --filter @albusforge/registry schemas`)", (name, contents) => {
    expect(readFileSync(path.join(REGISTRY_ROOT, "schemas", name), "utf8")).toBe(contents);
  });
});
