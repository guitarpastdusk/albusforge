/**
 * Units come from the capability name: `read.temperature_c` is °C. The table
 * lives in @albusforge/schema, so the validator here and the portal's readings
 * label from one source. Re-exported for this package's own callers.
 */
export { capabilityUnit, UNIT_SUFFIXES, VALUE_NAMESPACES } from "@albusforge/schema";
