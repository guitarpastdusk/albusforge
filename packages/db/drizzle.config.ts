import { defineConfig } from "drizzle-kit";

// Generation only: drizzle-kit never connects to a database here. Migrations
// are applied by src/migrate.ts in the pre-deploy Job.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
});
