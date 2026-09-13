import { telemetrySchema } from "./telemetry.js";
import { buildsSchema } from "./builds.js";
import { registrySchema } from "./registry.js";
import { usersSchema } from "./users.js";

export * from "./users.js";
export * from "./registry.js";
export * from "./builds.js";
export * from "./telemetry.js";

/**
 * Every Postgres schema the app role is granted on. A new pgSchema must be
 * added here too; a test fails if the migrated database has one this misses.
 */
export const APP_SCHEMAS = [usersSchema.schemaName, registrySchema.schemaName, buildsSchema.schemaName, telemetrySchema.schemaName];
