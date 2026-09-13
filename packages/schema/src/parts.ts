import { z } from "zod";
import { Capability, PartCategory, PartDefinition, PartId, PartInterface, PartStatus, SemVer } from "./part";

/**
 * `GET /v1/parts` and `GET /v1/parts/:id` (ARCHITECTURE.md §6): the registry as
 * gateway serves it from `registry.parts`. The Part Definition itself is in
 * part.ts; this file holds only the query and response wrappers.
 *
 * Each (id, version) row is immutable. Both routes answer with the highest
 * SemVer version of each id among the versions whose status matches the
 * filter.
 */

/** Every status except `retired`, which exists only to rebuild old snapshots. */
export const DEFAULT_PART_STATUSES = ["draft", "active", "deprecated"] as const satisfies readonly PartStatus[];

/** `?status=active,draft` or `?status=active&status=draft`. */
const StatusFilter = z
  .union([z.string(), z.array(z.string())])
  .transform((value) => (Array.isArray(value) ? value : [value]).flatMap((v) => v.split(",")).map((v) => v.trim()))
  .pipe(z.array(PartStatus).min(1));

/** Query for `GET /v1/parts`. An unset `status` means DEFAULT_PART_STATUSES. */
export const PartsQuery = z.strictObject({
  status: StatusFilter.optional(),
  category: PartCategory.optional(),
});
export type PartsQuery = z.infer<typeof PartsQuery>;

/** Query for `GET /v1/parts/:id`. */
export const PartQuery = z.strictObject({
  status: StatusFilter.optional(),
});
export type PartQuery = z.infer<typeof PartQuery>;

export const PartParams = z.object({ id: PartId });

/** One row of the browse list: the part without its blocks. */
export const PartSummary = z.object({
  id: PartId,
  version: SemVer,
  name: z.string(),
  category: PartCategory,
  status: PartStatus,
  successor: PartId.nullable(),
  interface: PartInterface,
  capabilities: z.array(Capability),
  unit_cost_usd: z.number().positive().nullable(),
});
export type PartSummary = z.infer<typeof PartSummary>;

/** Sorted by id. */
export const PartList = z.object({
  parts: z.array(PartSummary),
});
export type PartList = z.infer<typeof PartList>;

/** Every block of one version. */
export const PartDetail = z.object({
  part: PartDefinition,
});
export type PartDetail = z.infer<typeof PartDetail>;

export function summarizePart(part: PartDefinition): PartSummary {
  return {
    id: part.id,
    version: part.version,
    name: part.name,
    category: part.category,
    status: part.status,
    successor: part.successor,
    interface: part.electrical.interface,
    capabilities: part.software.capabilities,
    unit_cost_usd: part.commerce.unit_cost_usd,
  };
}
