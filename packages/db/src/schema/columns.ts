import { sql } from "drizzle-orm";
import { timestamp } from "drizzle-orm/pg-core";

export const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/**
 * `"column" IN ('a', 'b')` for a CHECK constraint. Status sets are text + CHECK
 * rather than pg enums so a value can be added or dropped in one migration.
 * Values are code constants, never input.
 */
export const oneOf = (column: string, values: readonly string[]) =>
  sql.raw(`"${column}" IN (${values.map((value) => `'${value}'`).join(", ")})`);
