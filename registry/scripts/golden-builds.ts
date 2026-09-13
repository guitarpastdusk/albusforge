/**
 * The three golden builds the MVP registry is chosen to cover (ARCHITECTURE.md
 * §4.1: "The set is chosen to cover exactly the three golden builds: fridge
 * monitor, presence alert, plant waterer."). The validator fails if the
 * registry stops providing any capability listed here, or if a build loses
 * its voltage-compatible power path.
 *
 * `requires` is what the build can't ship without. `optional` is what the
 * twelve parts are also there for; it is checked the same way, so dropping
 * the part behind it is a deliberate edit here too.
 *
 * These are capabilities, not part ids: which part provides them is the
 * matcher's decision (§7.2), never this file's.
 */
export interface GoldenBuild {
  id: string;
  name: string;
  requires: readonly string[];
  optional: readonly string[];
  /**
   * The intended power path: the capability of the part that powers the
   * build, and which brain input it's wired to (`primary` is the brain's
   * connector, anything else one of its `alt_inputs`). See scripts/lib/power.ts.
   */
  power: { supply: string; brain_input: string };
}

export const GOLDEN_BUILDS: readonly GoldenBuild[] = [
  {
    // CLOUD-PLATFORM.md §6.1: temperature and humidity charts, a battery gauge.
    id: "fridge-monitor",
    name: "Fridge monitor",
    requires: ["read.temperature_c", "read.humidity_pct", "net.wifi", "power.battery"],
    // Door-open detection by tilt; recharging the pack in place.
    optional: ["read.acceleration_g", "power.charge"],
    // The cell goes through the brain's 5V pin and onboard regulator. A full
    // cell (4.2 V) would overvolt the 3V3 pin.
    power: { supply: "power.battery", brain_input: "5v-pin" },
  },
  {
    id: "presence-alert",
    name: "Presence alert",
    requires: ["read.motion_bool", "net.wifi", "power.5v"],
    // Range-gating a detection by distance; a light level to skip daytime alerts.
    optional: ["read.distance_cm", "read.illuminance_lux"],
    // Voltage only: the supply's USB-C cable doesn't mate the brain's Micro-USB
    // port, and the connector decision (§18.1) is still open.
    power: { supply: "power.5v", brain_input: "primary" },
  },
  {
    // CLOUD-PLATFORM.md §3: the watering decision is made on-device.
    id: "plant-waterer",
    name: "Plant waterer",
    requires: ["read.soil_moisture_pct", "act.position_deg", "net.wifi", "power.5v"],
    optional: ["read.illuminance_lux"],
    power: { supply: "power.5v", brain_input: "primary" },
  },
];
