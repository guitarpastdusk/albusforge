import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ConnectorDefinition, PartDefinition } from "@albusforge/schema";
import { SolveInput, pin } from "./types";
import type { AssemblyProfile, SolveSpec } from "./types";

const registry = new URL("../../../registry/", import.meta.url);
export function registryParts(): PartDefinition[] {
  return readdirSync(new URL("parts/", registry)).sort().map(id => PartDefinition.parse(JSON.parse(readFileSync(new URL(`parts/${id}/part.json`, registry), "utf8"))));
}
export function connectors(): ConnectorDefinition[] {
  return readdirSync(fileURLToPath(new URL("connectors/", registry))).sort().filter(p => p.endsWith(".json"))
    .map(p => ConnectorDefinition.parse(JSON.parse(readFileSync(new URL(`connectors/${p}`, registry), "utf8"))));
}

/**
 * Synthetic acceptance catalogue, NOT hardware evidence or a registry promotion.
 * Keep capability names from the real registry; replace unverified/measured
 * attributes with explicit test values. Real draft-catalogue rejection is a
 * separate golden test. No test writes these values back to the registry.
 */
export function fixture(capabilities: string[] = ["read.temperature_c"]): SolveInput {
  const ids = ["C-001", "E-001", "E-005", "P-001", "P-002", "L-003", "P-005", "M-001"];
  const parts = registryParts().filter(p => ids.includes(p.id)).map(p => PartDefinition.parse({
    ...p, status: "active", name: `SYNTHETIC ${p.id}`,
    electrical: { ...p.electrical, logic_v: p.electrical.interface === "power" ? null : [3.3, 3.3],
      // Synthetic parts run from ideal rails. Actual tolerance rejection has its own test.
      voltage_range: p.electrical.interface === "host" ? [4, 5.5] : p.electrical.interface === "power" ? p.electrical.voltage_range : [3.0, 5.5],
      current_draw_ma: p.id === "C-001" ? { idle: 1, active: 100 } : p.electrical.current_draw_ma,
      ...(p.id === "C-001" ? { supply: { output_v: [3.3, 3.3], max_output_ma: 800, capacity_mah: null } } : {}),
    },
    mechanical: { ...p.mechanical, bounding_mm: [20, 10, 5], mount: { type: "cradle" } },
    commerce: { suppliers: [{ vendor: "adafruit", sku: "SYNTHETIC", url: "https://example.com/test" }], unit_cost_usd: p.commerce.unit_cost_usd ?? 10 },
  }));
  const brain = parts.find(p => p.id === "C-001")!;
  const profiles: AssemblyProfile[] = parts.filter(p => p.id === "E-001" || p.id === "E-005").map(source => ({
    id: `synthetic-${source.id}`, version: "1.0.0", evidence: "Synthetic test harness, not verified for a physical board",
    brain: pin(brain), source: pin(source), source_connector: source.electrical.connector,
    brain_input: source.id === "E-001" ? "5v-pin" : "primary",
    regulator_efficiency: 0.6, quiescent_source_ma: 0.1, battery_usable_fraction: 0.5,
    ports: [
      { id: "i2c", interface: "i2c", connector: "hsx-i2c-4pin-v1", rail: "brain", max_current_ma: 100, resources: ["sda", "scl"], capacity: 10 },
      { id: "probe", interface: "1-wire", connector: "hsx-3pin-v1", rail: "brain", max_current_ma: 100, resources: ["io1"], capacity: 1 },
      { id: "pir", interface: "gpio", connector: "hsx-3pin-v1", rail: "source", max_current_ma: 100, resources: ["io2"], capacity: 1 },
      { id: "soil", interface: "adc", connector: "hsx-3pin-v1", rail: "brain", max_current_ma: 100, resources: ["io3"], capacity: 1 },
      { id: "servo", interface: "pwm", connector: "hsx-3pin-v1", rail: "source", max_current_ma: 800, resources: ["io4"], capacity: 1 },
    ],
    activity: [{ part: pin(brain), active_s: 1, evidence: "Synthetic one-second active window" }],
  }));
  return SolveInput.parse({
    spec: { capabilities, transport: "wifi", power_source: "usb", interval_s: 60, runtime: "0.1.0" },
    parts, connectors: connectors(), profiles,
    compat: parts.filter(p => p.software.driver_pkg !== null).map(p => ({ driver_pkg: p.software.driver_pkg, driver_ver: p.software.driver_version, runtime_ver: "0.1.0", brain_id: brain.id, status: "passed" })),
    max_steps: 100_000,
  });
}

export const goldenSpecs: Record<string, Partial<SolveSpec> & { capabilities: string[] }> = {
  "fridge-monitor": { capabilities: ["read.temperature_c", "read.humidity_pct"], power_source: "battery", target_life_days: 7 },
  "presence-alert": { capabilities: ["read.motion_bool"], power_source: "usb" },
  "plant-waterer": { capabilities: ["read.soil_moisture_pct", "act.position_deg"], power_source: "usb" },
};
