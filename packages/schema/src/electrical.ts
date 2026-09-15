/**
 * Voltage rules shared by everything that reasons about a build's power path:
 * the registry's own checks (registry/scripts/lib/power.ts), and the portal,
 * which draws the same windows on an example build's wiring diagram.
 *
 * They live here, in the package both already depend on, so there is one
 * implementation of the rule rather than one per consumer.
 */

/** [min, max] volts. */
export type VoltageWindow = readonly [number, number];

/**
 * The window over which `source` can feed `input`, or null if it can't. The
 * source must never exceed the input's maximum. Below the input's minimum it
 * only stops working (a Li-ion cell sagging under a regulator's dropout), so
 * partial overlap is allowed, and the overlap is the usable window.
 */
export function usableWindow(source: VoltageWindow, input: VoltageWindow): VoltageWindow | null {
  if (source[1] > input[1]) return null;
  const low = Math.max(source[0], input[0]);
  return low <= source[1] ? [low, source[1]] : null;
}
