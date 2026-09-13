import { SemVer, SemVerRange } from "@albusforge/schema";
import { describe, expect, it } from "vitest";
import { compareSemver } from "../scripts/lib/semver";

// SemVer 2.0.0 §11's own precedence example, lowest first, then the core-number cases.
const ORDERED = [
  "1.0.0-alpha",
  "1.0.0-alpha.1",
  "1.0.0-alpha.beta",
  "1.0.0-beta",
  "1.0.0-beta.2",
  "1.0.0-beta.11",
  "1.0.0-rc.1",
  "1.0.0",
  "1.9.0",
  "1.10.0",
  "2.0.0",
];

// Valid and invalid spellings together: the comparator must stay a total order
// even for strings the schema rejects.
const MIXED = [
  ...ORDERED,
  "1.0.0-rc.01",
  "1.0.0-rc.001",
  "1.0.0-rc.10",
  "1.0.0-rc.2",
  "1.0.0-alpha-a",
  "1.0.0-alpha-b",
  "1.0.0-0",
  "1.0.0-00",
  "1.0.0-0a",
  "1.0.0-rc..1",
  "1.0.0-",
  "01.0.0",
  "1.00.0",
  "1.0.00",
  "10.0.0",
];

describe("SemVer schema (§2, §9)", () => {
  it.each([
    "1.0.0",
    "0.0.0",
    "10.20.30",
    "1.0.0-0",
    "1.0.0-rc.1",
    "1.0.0-rc.10",
    "1.0.0-alpha-a",
    "1.0.0-0a",
    "1.0.0-00a",
    "1.0.0-x.7.z.92",
    "1.0.0--",
  ])("accepts %s", (version) => {
    expect(SemVer.safeParse(version).success).toBe(true);
  });

  it.each([
    ["a numeric pre-release identifier with a leading zero", "1.0.0-rc.01"],
    ["a numeric pre-release of only zeroes", "1.0.0-00"],
    ["an empty identifier between dots", "1.0.0-rc..1"],
    ["an empty pre-release", "1.0.0-"],
    ["a leading empty identifier", "1.0.0-.rc"],
    ["a trailing empty identifier", "1.0.0-rc."],
    ["a leading zero in major", "01.0.0"],
    ["a leading zero in minor", "1.00.0"],
    ["a leading zero in patch", "1.0.00"],
    ["a missing patch", "1.0"],
    ["build metadata", "1.0.0+build.1"],
    ["a character outside [0-9A-Za-z-]", "1.0.0-rc_1"],
  ])("rejects %s (%s)", (_, version) => {
    expect(SemVer.safeParse(version).success).toBe(false);
  });

  it("applies the same rules inside a range", () => {
    expect(SemVerRange.safeParse(">=1.0.0-rc.1").success).toBe(true);
    expect(SemVerRange.safeParse(">=1.0.0-rc.01").success).toBe(false);
    expect(SemVerRange.safeParse("^01.0.0").success).toBe(false);
  });
});

describe("compareSemver", () => {
  it("follows SemVer §11 precedence", () => {
    for (let i = 0; i < ORDERED.length - 1; i++) {
      const [lower, higher] = [ORDERED[i]!, ORDERED[i + 1]!];
      expect(compareSemver(lower, higher), `${lower} < ${higher}`).toBe(-1);
      expect(compareSemver(higher, lower), `${higher} > ${lower}`).toBe(1);
    }
  });

  it("sorts a reversed list back into order", () => {
    expect([...ORDERED].reverse().sort(compareSemver)).toEqual(ORDERED);
  });

  it("compares numeric identifiers numerically", () => {
    expect(compareSemver("1.0.0-rc.10", "1.0.0-rc.2")).toBe(1);
  });

  it("keeps hyphens inside a pre-release identifier", () => {
    expect(compareSemver("1.0.0-alpha-a", "1.0.0-alpha-b")).toBe(-1);
    expect(compareSemver("1.0.0-alpha-b", "1.0.0-alpha")).toBe(1);
  });

  it("sorts a numeric identifier below an alphanumeric one", () => {
    expect(compareSemver("1.0.0-1", "1.0.0-a")).toBe(-1);
    expect(compareSemver("1.0.0-rc.1", "1.0.0-rc.x")).toBe(-1);
  });

  it("is antisymmetric, and zero only for identical strings, across every pair", () => {
    for (const a of MIXED) {
      for (const b of MIXED) {
        const ab = compareSemver(a, b);
        const ba = compareSemver(b, a);
        // Summed rather than negated: -Math.sign(0) is -0, which toBe (Object.is) treats as unequal to 0.
        expect(Math.sign(ab) + Math.sign(ba), `sign(cmp(${a}, ${b})) === -sign(cmp(${b}, ${a}))`).toBe(0);
        expect(ab === 0, `cmp(${a}, ${b}) is 0 only when identical`).toBe(a === b);
      }
    }
  });

  it("is transitive: every ordering of the mixed list sorts to the same result", () => {
    const reference = [...MIXED].sort(compareSemver);
    for (let shift = 1; shift < MIXED.length; shift++) {
      const rotated = [...MIXED.slice(shift), ...MIXED.slice(0, shift)];
      expect(rotated.sort(compareSemver)).toEqual(reference);
    }
    expect([...MIXED].reverse().sort(compareSemver)).toEqual(reference);
    for (let i = 0; i < reference.length - 1; i++) {
      expect(compareSemver(reference[i]!, reference[i + 1]!), `${reference[i]} < ${reference[i + 1]}`).toBe(-1);
    }
  });

  it("puts equal-precedence spellings in a fixed order, not the argument order", () => {
    expect(compareSemver("1.0.0-rc.01", "1.0.0-rc.1")).toBe(-1);
    expect(compareSemver("1.0.0-rc.1", "1.0.0-rc.01")).toBe(1);
  });
});
