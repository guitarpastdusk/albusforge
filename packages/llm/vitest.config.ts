import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    environment: "node",
    // Refuses to run with a real API key in CI: tests only ever replay recorded responses.
    setupFiles: ["./test/no-live-calls.ts"],
  },
});
