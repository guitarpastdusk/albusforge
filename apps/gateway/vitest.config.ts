import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // routes.db.test.ts runs against a real PostgreSQL 16 in Docker; the first run pulls the image.
    hookTimeout: 180_000,
    testTimeout: 60_000,
  },
});
