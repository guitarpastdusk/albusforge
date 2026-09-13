import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  // Cloud Run image: server.js plus only the traced node_modules.
  output: "standalone",
  // Trace from the repo root so workspace packages land in the standalone
  // bundle; server.js then sits at apps/web/server.js inside it.
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  transpilePackages: ["@albusforge/schema"],
  // Type-check shipped code only: see tsconfig.build.json.
  typescript: { tsconfigPath: "tsconfig.build.json" },
  poweredByHeader: false,
};

export default config;
