import { readFileSync } from "node:fs";
import path from "node:path";
import type { LlmResponse } from "../src/types";

const dir = path.join(import.meta.dirname, "fixtures");

/** A recorded response by name (test/fixtures/<name>.json). */
export function fixture(name: "valid" | "refusal" | "max-tokens" | "invalid-json" | "schema-mismatch"): LlmResponse {
  return JSON.parse(readFileSync(path.join(dir, `${name}.json`), "utf8")) as LlmResponse;
}
