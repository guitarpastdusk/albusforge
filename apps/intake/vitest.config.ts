import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    environment: "node",
    // Refuses to run with a real API key in CI: every model response is a recorded fixture.
    setupFiles: ["./test/no-live-calls.ts"],
    // handler.db.test.ts runs against a real PostgreSQL 16 in Docker; the first run pulls the image.
    hookTimeout: 180_000,
    testTimeout: 60_000,
  },
});
