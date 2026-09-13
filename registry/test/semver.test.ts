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

describe("compareSemver", () => {
  it("follows SemVer §11 precedence", () => {
    for (let i = 0; i < ORDERED.length - 1; i++) {
      const [lower, higher] = [ORDERED[i]!, ORDERED[i + 1]!];
      expect(compareSemver(lower, higher), `${lower} < ${higher}`).toBeLessThan(0);
      expect(compareSemver(higher, lower), `${higher} > ${lower}`).toBeGreaterThan(0);
    }
  });

  it("sorts a reversed list back into order", () => {
    expect([...ORDERED].reverse().sort(compareSemver)).toEqual(ORDERED);
  });

  it("compares numeric identifiers numerically", () => {
    expect(compareSemver("1.0.0-rc.10", "1.0.0-rc.2")).toBeGreaterThan(0);
  });

  it("keeps hyphens inside a pre-release identifier", () => {
    expect(compareSemver("1.0.0-alpha-a", "1.0.0-alpha-b")).toBeLessThan(0);
    expect(compareSemver("1.0.0-alpha-b", "1.0.0-alpha-a")).toBeGreaterThan(0);
    expect(compareSemver("1.0.0-alpha-b", "1.0.0-alpha")).toBeGreaterThan(0);
  });

  it("sorts a numeric identifier below an alphanumeric one", () => {
    expect(compareSemver("1.0.0-1", "1.0.0-a")).toBeLessThan(0);
    expect(compareSemver("1.0.0-rc.1", "1.0.0-rc.x")).toBeLessThan(0);
  });

  it("treats equal versions as equal", () => {
    expect(compareSemver("1.0.0-rc.1", "1.0.0-rc.1")).toBe(0);
    expect(compareSemver("2.3.4", "2.3.4")).toBe(0);
  });
});
