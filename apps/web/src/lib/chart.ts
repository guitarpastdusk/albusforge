/*
 * Geometry for the dashboard's line chart. Pure, so it is tested without a DOM.
 * The SVG is drawn in a 600 × 160 viewBox; points use the top 150 units.
 */

export const CHART_WIDTH = 600;
export const CHART_HEIGHT = 150;

export interface ChartDomain {
  lo: number;
  hi: number;
}

/**
 * Value range to draw: 2 units of room below the lowest of the data and the
 * threshold, 8 units of headroom above the data, rounded outwards. For the
 * greenhouse probe (31.2–42 % VWC, threshold 22) that is 20–50, the design's scale.
 */
export function chartDomain(values: readonly number[], threshold: number | null): ChartDomain | null {
  if (values.length === 0) return null;
  const low = Math.min(...values, ...(threshold === null ? [] : [threshold]));
  const high = Math.max(...values);
  const lo = Math.floor(low - 2);
  const hi = Math.max(Math.ceil(high + 8), lo + 1);
  return { lo, hi };
}

const round = (n: number) => Math.round(n * 100) / 100;

export function valueToY(value: number, { lo, hi }: ChartDomain, height = CHART_HEIGHT): number {
  return round(height - ((value - lo) / (hi - lo)) * height);
}

/** "x,y x,y …" for an SVG polyline, spread evenly across the width. */
export function polylinePoints(values: readonly number[], domain: ChartDomain, width = CHART_WIDTH): string {
  const last = Math.max(values.length - 1, 1);
  return values.map((value, i) => `${round((i / last) * width)},${valueToY(value, domain)}`).join(" ");
}
