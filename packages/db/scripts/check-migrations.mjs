// Fails when src/schema has changes that no committed migration captures.
// Regenerates into a scratch copy of migrations/, so a clean checkout stays
// clean. Fix with: pnpm --filter @albusforge/db db:generate
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";

const pkg = path.resolve(import.meta.dirname, "..");
// Inside the package and passed relatively: drizzle-kit prefixes --out with "./".
const scratch = mkdtempSync(path.join(pkg, ".migrations-check-"));

try {
  cpSync(path.join(pkg, "migrations"), scratch, { recursive: true });
  const result = spawnSync(
    // The package's own binary, so the check runs the same outside `pnpm run`.
    path.join(pkg, "node_modules", ".bin", "drizzle-kit"),
    ["generate", "--dialect", "postgresql", "--schema", "./src/schema/index.ts", "--out", path.relative(pkg, scratch)],
    { cwd: pkg, encoding: "utf8" },
  );
  const output = `${result.error ?? ""}${result.stdout ?? ""}${result.stderr ?? ""}`;

  // drizzle-kit exits 0 even when it fails to read the folder, so pass only on
  // its explicit no-diff message.
  if (result.status === 0 && output.includes("No schema changes, nothing to migrate")) {
    console.log("Migrations match src/schema.");
  } else {
    console.error(output);
    console.error("Migrations are out of date with src/schema (or drizzle-kit failed; see above).");
    console.error("Run `pnpm --filter @albusforge/db db:generate` and commit the result.");
    process.exitCode = 1;
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
