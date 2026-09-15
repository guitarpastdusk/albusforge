/*
 * Which colour a channel's marks take.
 *
 * Fixed order, never cycled: channel one is always slot one, and adding a
 * channel never repaints the others. The steps live in styles/tokens.css, where
 * the validation they passed is recorded.
 *
 * Past five channels the colour repeats. That is deliberate rather than
 * generating a sixth hue: every plot here is a single series with its own
 * heading and unit, so the colour is redundant encoding and a repeat costs
 * nothing. It would be wrong in a shared plot, where colour alone carries
 * identity.
 */
export const SERIES_SLOTS = 5;

export function seriesColor(index: number): string {
  return `var(--color-series-${(index % SERIES_SLOTS) + 1})`;
}
