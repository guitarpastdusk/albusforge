/**
 * Orders two semver strings following SemVer 2.0.0 §11:
 * - major, minor and patch compare numerically
 * - a pre-release sorts before its release
 * - pre-releases compare identifier by identifier: numeric identifiers
 *   compare numerically, a numeric identifier sorts below an alphanumeric
 *   one, alphanumerics compare in ASCII order, and a shorter run of equal
 *   identifiers sorts first
 *
 * The schema only admits valid SemVer, but this stays a total, antisymmetric
 * order for any input. Two strings that tie on precedence (`rc.01` and `rc.1`,
 * which §9 forbids) fall back to a plain string compare, so the result is
 * zero only for identical strings and never depends on argument order.
 *
 * Returns -1, 0 or 1.
 */
export function compareSemver(a: string, b: string): number {
  const [coreA, preA] = splitVersion(a);
  const [coreB, preB] = splitVersion(b);

  let result = compareIdentifiers(coreA.split("."), coreB.split("."));
  if (result === 0) {
    if (preA === undefined && preB !== undefined) result = 1;
    else if (preA !== undefined && preB === undefined) result = -1;
    else if (preA !== undefined && preB !== undefined) result = compareIdentifiers(preA.split("."), preB.split("."));
  }
  if (result !== 0) return result;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Splits at the first hyphen only: `1.0.0-alpha-a` is core `1.0.0`, pre-release `alpha-a`. */
function splitVersion(version: string): [core: string, pre: string | undefined] {
  const hyphen = version.indexOf("-");
  return hyphen === -1 ? [version, undefined] : [version.slice(0, hyphen), version.slice(hyphen + 1)];
}

const NUMERIC = /^\d+$/;

/**
 * One identifier against another: numerics by value (as BigInt, since they're
 * arbitrary length) below everything else, which compares as strings. Equal
 * numeric values tie here, whatever their spelling.
 */
function compareIdentifier(a: string, b: string): number {
  const numA = NUMERIC.test(a);
  const numB = NUMERIC.test(b);
  if (numA && numB) {
    const [x, y] = [BigInt(a), BigInt(b)];
    return x < y ? -1 : x > y ? 1 : 0;
  }
  if (numA) return -1;
  if (numB) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Lexicographic over identifiers; a shorter run of equal identifiers sorts first. */
function compareIdentifiers(a: readonly string[], b: readonly string[]): number {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i++) {
    const result = compareIdentifier(a[i]!, b[i]!);
    if (result !== 0) return result;
  }
  return Math.sign(a.length - b.length);
}
