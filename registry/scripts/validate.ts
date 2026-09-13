/**
 * Validates the whole registry: every part.json and connector against the
 * zod schemas in packages/schema, then the cross-part rules in lib/rules.ts.
 * Exits 1 with one line per problem. Runs as this package's `lint` task.
 */
import { GOLDEN_BUILDS } from "./golden-builds";
import { loadRegistry } from "./lib/load";
import { formatIssues, validateRegistry } from "./lib/rules";

const { issues, parts, connectors } = validateRegistry({ ...loadRegistry(), goldenBuilds: GOLDEN_BUILDS });

if (issues.length > 0) {
  console.error(`registry: ${issues.length} problem${issues.length === 1 ? "" : "s"}\n${formatIssues(issues)}`);
  process.exit(1);
}

const counts = new Map<string, number>();
for (const { part } of parts) counts.set(part.status, (counts.get(part.status) ?? 0) + 1);
const byStatus = [...counts].sort().map(([status, n]) => `${n} ${status}`).join(", ");
console.log(`registry ok: ${parts.length} parts (${byStatus}), ${connectors.length} connectors`);
