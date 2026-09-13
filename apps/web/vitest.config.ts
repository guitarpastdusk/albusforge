import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // server-only throws outside a React Server Components build; tests
      // import server modules directly, so use its no-op entry.
      "server-only": path.resolve(import.meta.dirname, "node_modules/server-only/empty.js"),
    },
  },
  // tsconfig says "jsx": "preserve" because Next.js compiles JSX itself; the
  // component render tests need Vite to transform it.
  oxc: {
    jsx: { runtime: "automatic" },
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
  },
});
