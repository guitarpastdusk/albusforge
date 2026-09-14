/**
 * Units come from the capability name, so there is one place to read them:
 * `read.temperature_c` is °C. Every `read.*` and `act.*` capability must end
 * in one of these suffixes; the registry's validator enforces it, and the
 * portal labels its readings from the same table.
 */
export const UNIT_SUFFIXES = {
  _c: "°C",
  _pct: "%",
  _hpa: "hPa",
  _g: "g",
  _dps: "°/s",
  _cm: "cm",
  _lux: "lx",
  _deg: "°",
  _bool: "true/false",
} as const;

/** Namespaces whose capabilities carry a measured or commanded value. */
export const VALUE_NAMESPACES = ["read", "act"] as const;

/**
 * The unit for a capability: a string for `read.*`/`act.*`, null for
 * namespaces without values (`bus.*`, `power.*`), undefined when a value
 * capability has no known unit suffix.
 */
export function capabilityUnit(capability: string): string | null | undefined {
  const namespace = capability.split(".", 1)[0];
  if (!VALUE_NAMESPACES.some((ns) => ns === namespace)) return null;
  const match = Object.entries(UNIT_SUFFIXES).find(([suffix]) => capability.endsWith(suffix));
  return match?.[1];
}
