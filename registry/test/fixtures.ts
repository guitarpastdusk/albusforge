import type { GoldenBuild } from "../scripts/golden-builds";
import type { RawFile } from "../scripts/lib/load";
import type { RegistryInput } from "../scripts/lib/rules";

/**
 * A small registry that passes every rule: a brain, two sensors and a
 * battery. Each test takes a fresh copy and breaks one thing.
 */

// Fixtures are deliberately loose JSON; tests poke at them before validation.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;

function part(id: string, data: Json): RawFile {
  // Cloned so a test that edits one part never reaches another through a shared object.
  return { path: `parts/${id}/part.json`, name: id, data: structuredClone({ id, version: "1.0.0", successor: null, ...data }) };
}

function connector(id: string, interfaces: string[]): RawFile {
  return {
    path: `connectors/${id}.json`,
    name: id,
    data: {
      id,
      version: "1.0.0",
      name: id,
      housing: "JST PH 2.0 mm",
      pins: [
        { n: 1, name: "VCC", role: "power" },
        { n: 2, name: "GND", role: "ground" },
      ],
      interfaces,
      max_voltage: 5.5,
    },
  };
}

const mechanical = (overrides: Json = {}) => ({
  footprint_file: "footprint.step",
  bounding_mm: [20, 10, 5],
  mount: { type: "standoffs", hole_d_mm: 2.5, holes_mm: [[2.5, 2.5]] },
  exposure: "none",
  environment_flags: [],
  ...overrides,
});

const cloud = { telemetry_schema: null, default_widgets: [], alert_templates: [] };
const commerce = { suppliers: [{ vendor: "adafruit", sku: "1", url: "https://www.adafruit.com/product/1" }], unit_cost_usd: 1 };

export const TEST_GOLDEN_BUILDS: GoldenBuild[] = [
  { id: "test", name: "Test build", requires: ["read.temperature_c", "net.wifi"], optional: ["power.battery"] },
];

export function goodInput(): RegistryInput {
  return {
    parts: [
      part("C-001", {
        name: "Brain",
        category: "communication",
        status: "active",
        electrical: {
          interface: "host",
          connector: "usb-c-v1",
          voltage_range: [3.0, 3.6],
          current_draw_ma: { idle: 0.01, active: 300 },
          requires: [],
          conflicts: [],
          i2c_address: null,
        },
        mechanical: mechanical({ environment_flags: ["rf-radiator"] }),
        software: {
          driver_pkg: null,
          driver_version: null,
          sdk_module: null,
          capabilities: ["bus.i2c", "gpio.digital", "net.wifi"],
          min_runtime: ">=0.1.0",
        },
        cloud,
        commerce,
      }),
      part("E-001", {
        name: "Battery",
        category: "energy",
        status: "active",
        electrical: {
          interface: "power",
          connector: "hsx-power-2pin-v1",
          voltage_range: [2.75, 4.2],
          current_draw_ma: { idle: 0, active: 0 },
          requires: [],
          conflicts: [],
          i2c_address: null,
          supply: { output_v: [2.75, 4.2], max_output_ma: 1000, capacity_mah: 2200 },
        },
        mechanical: mechanical({ mount: { type: "cradle" }, environment_flags: ["li-ion"] }),
        software: { driver_pkg: null, driver_version: null, sdk_module: "power/battery", capabilities: ["power.battery"], min_runtime: ">=0.1.0" },
        cloud,
        commerce,
      }),
      part("P-001", {
        name: "I2C temperature",
        category: "physical",
        status: "active",
        electrical: {
          interface: "i2c",
          connector: "hsx-i2c-4pin-v1",
          voltage_range: [3.0, 5.0],
          current_draw_ma: { idle: 0.0001, active: 0.7 },
          requires: ["bus.i2c"],
          conflicts: [],
          i2c_address: "0x77",
        },
        mechanical: mechanical({ exposure: "vent", environment_flags: ["needs-airflow", "temp:-40..85C"] }),
        software: {
          driver_pkg: "hsx-driver-test",
          driver_version: "0.1.0",
          sdk_module: "sensors/temperature",
          capabilities: ["read.temperature_c"],
          min_runtime: ">=0.1.0",
        },
        cloud: { telemetry_schema: "temperature.v1", default_widgets: ["line-chart"], alert_templates: ["out_of_range"] },
        commerce,
      }),
      part("P-002", {
        name: "Probe (draft, no footprint yet)",
        category: "physical",
        status: "draft",
        electrical: {
          interface: "1-wire",
          connector: "hsx-3pin-v1",
          voltage_range: [3.0, 5.5],
          current_draw_ma: { idle: 0.001, active: 1.5 },
          requires: ["gpio.digital"],
          conflicts: [],
          i2c_address: null,
        },
        mechanical: mechanical({ bounding_mm: null, mount: { type: "cable-gland", d_mm: 6 }, exposure: "probe-external" }),
        software: {
          driver_pkg: "hsx-driver-probe",
          driver_version: "0.1.0",
          sdk_module: "sensors/temperature",
          capabilities: ["read.temperature_c"],
          min_runtime: ">=0.1.0",
        },
        cloud,
        commerce: { suppliers: [], unit_cost_usd: null },
      }),
    ],
    connectors: [
      connector("hsx-3pin-v1", ["1-wire", "adc", "gpio", "pwm"]),
      connector("hsx-i2c-4pin-v1", ["i2c"]),
      connector("hsx-power-2pin-v1", ["power"]),
      connector("usb-c-v1", ["power", "host"]),
    ],
    i2cShared: { path: "i2c-shared.json", name: "i2c-shared", data: [] },
    footprintExists: () => true,
    goldenBuilds: TEST_GOLDEN_BUILDS,
  };
}

/** The mutable data of one part in a fixture. */
export function partData(input: RegistryInput, id: string): Json {
  const file = input.parts.find((p) => p.name === id);
  if (!file) throw new Error(`fixture has no ${id}`);
  return file.data;
}
