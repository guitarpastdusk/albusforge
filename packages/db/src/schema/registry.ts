import { check, jsonb, pgSchema, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { oneOf } from "./columns.js";

/** The parts menu, loaded from /registry by the registry-load Job. */
export const registrySchema = pgSchema("registry");

export const PART_STATUSES = ["draft", "active", "deprecated", "retired"] as const;
export type PartStatus = (typeof PART_STATUSES)[number];

// Rows are immutable per (id, version): plans pin both forever (ARCHITECTURE.md §5.1).
export const parts = registrySchema.table(
  "parts",
  {
    id: text("id").notNull(),
    version: text("version").notNull(),
    status: text("status", { enum: PART_STATUSES }).notNull(),
    definition: jsonb("definition").notNull(),
    loadedAt: timestamp("loaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.version] }),
    check("parts_status_check", oneOf("status", PART_STATUSES)),
  ],
);

// brain_id is a part id without a version, so there is no FK to parts.
export const compatMatrix = registrySchema.table(
  "compat_matrix",
  {
    driverPkg: text("driver_pkg").notNull(),
    driverVer: text("driver_ver").notNull(),
    runtimeVer: text("runtime_ver").notNull(),
    brainId: text("brain_id").notNull(),
    status: text("status").notNull(),
  },
  (t) => [primaryKey({ columns: [t.driverPkg, t.driverVer, t.runtimeVer, t.brainId] })],
);
