/**
 * Orders two semver strings already validated by the schema, following
 * SemVer 2.0.0 §11:
 * - compare major, minor and patch numerically
 * - a pre-release sorts before its release
 * - pre-releases compare identifier by identifier: numeric identifiers
 *   compare numerically, a numeric identifier sorts below an alphanumeric
 *   one, alphanumerics compare in ASCII order, and a shorter run of equal
 *   identifiers sorts first
 *
 * Returns a negative number, zero or a positive number.
 */
export function compareSemver(a: string, b: string): number {
  const [coreA, preA] = splitVersion(a);
  const [coreB, preB] = splitVersion(b);

  const numsA = coreA.split(".").map(Number);
  const numsB = coreB.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (numsA[i] ?? 0) - (numsB[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }

  if (preA === undefined && preB === undefined) return 0;
  if (preA === undefined) return 1;
  if (preB === undefined) return -1;
  return comparePrerelease(preA.split("."), preB.split("."));
}

/** Splits at the first hyphen only: `1.0.0-alpha-a` is core `1.0.0`, pre-release `alpha-a`. */
function splitVersion(version: string): [core: string, pre: string | undefined] {
  const hyphen = version.indexOf("-");
  return hyphen === -1 ? [version, undefined] : [version.slice(0, hyphen), version.slice(hyphen + 1)];
}

const NUMERIC = /^\d+$/;

function comparePrerelease(a: readonly string[], b: readonly string[]): number {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i++) {
    const idA = a[i]!;
    const idB = b[i]!;
    if (idA === idB) continue;
    const numA = NUMERIC.test(idA);
    const numB = NUMERIC.test(idB);
    // Identifiers are arbitrary length, so compare numerics as BigInt, not Number.
    if (numA && numB) return BigInt(idA) < BigInt(idB) ? -1 : 1;
    if (numA) return -1;
    if (numB) return 1;
    return idA < idB ? -1 : 1;
  }
  return Math.sign(a.length - b.length);
}
