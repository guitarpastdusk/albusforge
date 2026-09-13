import { type CandidatePart, type PartDefinition, summarizePart } from "@albusforge/schema";
import { z } from "zod";

/**
 * The few `builds.specs.data` fields gateway reads. Everything else passes
 * through untouched to `BuildDetail.spec`.
 *
 * TODO(m2/intake): switch to `Spec` from `@albusforge/schema` (packages/schema
 * src/spec.ts) once that branch merges, and drop this reader.
 */
export const StoredSpecFields = z.looseObject({
  capabilities: z.array(z.string()).optional(),
  settled: z.boolean().optional(),
});

/** The spec's capabilities, or none when the stored data doesn't have a readable list. */
export function specCapabilities(data: unknown): string[] {
  const parsed = StoredSpecFields.safeParse(data);
  return parsed.success ? (parsed.data.capabilities ?? []) : [];
}

/**
 * Parts whose capabilities intersect the spec's, each with the capabilities it
 * matched, sorted by id. Deterministic, and deliberately naive: a capability
 * match, not a solved plan (M3's matcher does that).
 */
export function matchCandidates(parts: readonly PartDefinition[], capabilities: readonly string[]): CandidatePart[] {
  const wanted = new Set(capabilities);
  if (wanted.size === 0) return [];
  return parts
    .map((part) => ({ part, matched: [...new Set(part.software.capabilities.filter((c) => wanted.has(c)))].sort() }))
    .filter(({ matched }) => matched.length > 0)
    .sort((a, b) => (a.part.id < b.part.id ? -1 : a.part.id > b.part.id ? 1 : 0))
    .map(({ part, matched }) => ({ ...summarizePart(part), matched_capabilities: matched }));
}
