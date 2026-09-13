import { compareSemver } from "@albusforge/registry/semver";

/** The limited range grammar of PartSoftware.min_runtime (no unions/wildcards). */
export function satisfiesRuntime(version: string, range: string): boolean {
  const op = /^(>=|\^|~)/.exec(range)?.[0] ?? "";
  const floor = range.slice(op.length);
  if (op === "") return compareSemver(version, floor) === 0;
  // Range prereleases opt in to the same core only, as in SemVer ranges.
  if (version.includes("-") && (!floor.includes("-") || version.split("-")[0] !== floor.split("-")[0])) return false;
  if (compareSemver(version, floor) < 0) return false;
  if (op === ">=") return true;
  const [major, minor, patch] = floor.split("-")[0]!.split(".").map(BigInt) as [bigint, bigint, bigint];
  const upper = op === "~" ? `${major}.${minor + 1n}.0`
    : major > 0n ? `${major + 1n}.0.0`
    : minor > 0n ? `0.${minor + 1n}.0` : `0.0.${patch + 1n}`;
  return compareSemver(version, upper) < 0;
}
