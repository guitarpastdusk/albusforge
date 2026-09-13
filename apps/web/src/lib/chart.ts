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

/** The threshold label sits 8 units above its line in 12-unit type: keep ~20 of 150 units clear above it. */
const LABEL_ROOM = 20 / (CHART_HEIGHT - 20);

/**
 * Value range to draw, with the threshold counted at both ends: 2 units of room
 * below the lowest of data and threshold, 8 units of headroom above the
 * highest, and enough above a high threshold for its label. Rounded outwards,
 * on the true scale. For the greenhouse probe (31.2–42 % VWC, threshold 22)
 * that is 20–50, the design's scale.
 */
export function chartDomain(values: readonly number[], threshold: number | null): ChartDomain | null {
  if (values.length === 0) return null;
  const points = threshold === null ? values : [...values, threshold];
  const lo = Math.floor(Math.min(...points) - 2);
  const high = Math.max(...points);
  const labelHeadroom = threshold === null ? -Infinity : threshold + (threshold - lo) * LABEL_ROOM;
  const hi = Math.max(Math.ceil(Math.max(high + 8, labelHeadroom)), lo + 1);
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
