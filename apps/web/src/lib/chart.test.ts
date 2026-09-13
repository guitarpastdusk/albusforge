import { describe, expect, it } from "vitest";
import { chartDomain, polylinePoints, valueToY } from "./chart";

const SOIL_24H = [
  42, 41, 40.5, 39, 38.6, 38, 37.2, 36.8, 36, 35.1, 34.8, 34, 33.5, 33.2, 32.8, 32.4, 32, 31.8, 31.5, 31.4, 31.3, 31.2,
];

describe("chartDomain", () => {
  it("reproduces the design's 20–50 scale for the greenhouse probe", () => {
    expect(chartDomain(SOIL_24H, 22)).toEqual({ lo: 20, hi: 50 });
  });

  it("works without a threshold", () => {
    expect(chartDomain([10, 12], null)).toEqual({ lo: 8, hi: 20 });
  });

  it("returns null with no data", () => {
    expect(chartDomain([], 22)).toBeNull();
  });

  it("never collapses to a zero-height range", () => {
    const domain = chartDomain([-1000], null)!;
    expect(domain.hi).toBeGreaterThan(domain.lo);
  });
});

describe("polylinePoints", () => {
  it("matches the design's points: x across 600, y = 150 − (v − 20) × 5", () => {
    const domain = chartDomain(SOIL_24H, 22)!;
    const r = (n: number) => Math.round(n * 100) / 100;
    const expected = SOIL_24H.map((v, i) => `${r((i / 21) * 600)},${r(150 - (v - 20) * 5)}`).join(" ");
    expect(polylinePoints(SOIL_24H, domain)).toBe(expected);
  });

  it("places a single point at x = 0", () => {
    expect(polylinePoints([30], { lo: 20, hi: 50 })).toBe("0,100");
  });

  it("maps the threshold on the same scale as the line", () => {
    expect(valueToY(22, { lo: 20, hi: 50 })).toBe(140);
  });
});

describe("thresholds outside the readings", () => {
  const inside = (y: number) => y >= 0 && y <= 150;

  it("keeps a threshold above every sample inside the viewBox, with room for its label", () => {
    const domain = chartDomain([10, 12], 30)!;
    const y = valueToY(30, domain);
    expect(inside(y)).toBe(true);
    expect(y - 8 - 12).toBeGreaterThanOrEqual(0);
    for (const v of [10, 12]) expect(inside(valueToY(v, domain))).toBe(true);
  });

  it("keeps a threshold below every sample inside the viewBox", () => {
    const domain = chartDomain([40, 42], 5)!;
    expect(inside(valueToY(5, domain))).toBe(true);
    expect(valueToY(5, domain) - 20).toBeGreaterThanOrEqual(0);
    for (const v of [40, 42]) expect(inside(valueToY(v, domain))).toBe(true);
  });

  it("stays on the true scale: a higher value is always drawn higher", () => {
    const domain = chartDomain([10, 12], 30)!;
    expect(valueToY(30, domain)).toBeLessThan(valueToY(12, domain));
    expect(valueToY(12, domain)).toBeLessThan(valueToY(10, domain));
  });
});
