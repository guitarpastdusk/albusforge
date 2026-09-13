/**
 * What may be logged about a database error. Drizzle wraps every failed query
 * in a DrizzleQueryError whose message (and so stack) carries the SQL and its
 * parameters, which can be private message text or an owner hash. pg's own
 * message can quote input values too ("invalid input syntax for type uuid:
 * ..."). So for a database error only the structured fields are logged: the
 * SQLSTATE and where it happened, never a message, stack or parameter.
 */

const SQLSTATE = /^[0-9A-Z]{5}$/;

/** pg DatabaseError fields that name a place or a class, never a value. */
const SAFE_FIELDS = ["code", "severity", "constraint", "table", "column", "schema", "dataType", "routine"] as const;

/** Safe fields for an error that came from a database query; undefined for any other error. */
export function databaseErrorFields(error: unknown): Record<string, string> | undefined {
  let fromDatabase = false;
  let pgError: Record<string, unknown> | undefined;
  for (let current = error, depth = 0; current instanceof Error && depth < 5; current = current.cause, depth++) {
    if (current.name === "DrizzleQueryError") fromDatabase = true;
    const fields = current as unknown as Record<string, unknown>;
    if (typeof fields.code === "string" && SQLSTATE.test(fields.code) && typeof fields.severity === "string") {
      pgError = fields;
      fromDatabase = true;
    }
  }
  if (!fromDatabase) return undefined;
  const safe: Record<string, string> = { kind: pgError ? "DatabaseError" : "DrizzleQueryError" };
  for (const key of SAFE_FIELDS) {
    const value = pgError?.[key];
    if (typeof value === "string") safe[key] = value;
  }
  return safe;
}

/** Log options for an error: `{ database }` fields for a database error, the error itself otherwise. */
export function describeError(error: unknown): { error?: unknown; fields?: Record<string, unknown> } {
  const database = databaseErrorFields(error);
  return database ? { fields: { database } } : { error };
}
