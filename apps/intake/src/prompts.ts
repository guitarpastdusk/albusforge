import { readFileSync } from "node:fs";

/**
 * Prompt files, read from apps/intake/prompts. The URL resolves from both
 * src/prompts.ts (dev, tests) and dist/server.js (the bundle), and the image
 * keeps that layout.
 */
const PROMPTS_DIR = new URL("../prompts/", import.meta.url);

export const EXTRACT_ROUTE_NAME = "intake.extract.v1";

export interface Prompts {
  extract: string;
  turn: string;
}

export function loadPrompts(dir: URL = PROMPTS_DIR): Prompts {
  return {
    extract: readFileSync(new URL("extract.v1.md", dir), "utf8"),
    turn: readFileSync(new URL("turn.v1.md", dir), "utf8"),
  };
}

export function renderTemplate(template: string, values: Readonly<Record<string, string>>): string {
  const out = template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = values[key];
    if (value === undefined) throw new Error(`prompt placeholder {{${key}}} has no value`);
    return value;
  });
  return out;
}
