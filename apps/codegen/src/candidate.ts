import { BuildPlanMetadata, BuildPlanV1, type Spec } from "@albusforge/schema";
export const COMPILER_IMAGE =
  "espressif/idf@sha256:8ccd4d2ce413889c6c2bba57e986c670302094efb91c913c6091152e317a7805";
/** A catalogue carries exactly one runtime; the numeric path stays at 0.1.0. */
export const RUNTIME = "0.1.0";
export interface Pin {
  readonly id: string;
  readonly version: string;
}
export interface ChannelRange {
  readonly unit: string;
  readonly min: number;
  readonly max: number;
}
/**
 * Numeric channel identity. firmware/esp32s3/main/include/hsx-channels.h
 * declares the same key/unit/min/max tuples and firmware-channels.test.ts
 * fails if the two ever drift apart.
 */
export const SENSORS = {
  bh1750: {
    macro: "HSX_SENSOR_BH1750",
    driver_pkg: "hsx-driver-bh1750",
    i2c_address: "0x23",
    channels: { illuminance: { unit: "lux", min: 0, max: 65535 } },
  },
  bme280: {
    macro: "HSX_SENSOR_BME280",
    driver_pkg: "hsx-driver-bme280",
    i2c_address: "0x77",
    channels: {
      temperature: { unit: "degC", min: -40, max: 85 },
      humidity: { unit: "%RH", min: 0, max: 100 },
      pressure: { unit: "hPa", min: 300, max: 1100 },
    },
  },
  seesaw_soil: {
    macro: "HSX_SENSOR_SEESAW_SOIL",
    driver_pkg: "hsx-driver-seesaw-soil",
    i2c_address: "0x36",
    channels: { soil_moisture: { unit: "raw", min: 0, max: 4095 } },
  },
} as const satisfies Record<
  string,
  {
    macro: string;
    driver_pkg: string;
    i2c_address: string;
    channels: Record<string, ChannelRange>;
  }
>;
export type SensorKey = keyof typeof SENSORS;
export interface PeripheralOption {
  readonly part: Pin;
  readonly sensor: SensorKey;
  readonly driver_ver: string;
  /** Connectors this part may be wired through. The assembly profile must
   * carry a port with the same connector on this candidate's bus resources. */
  readonly connectors: readonly string[];
}
/**
 * One entry per physically reviewed board wiring. This is an allow-list, not a
 * rule engine: a plan is compiled only when its brain, source, peripherals,
 * port resources and driver compatibility rows are all named here.
 * Every part version lives in this table and nowhere else, so a registry
 * promotion is a one-line edit per candidate.
 */
export interface NumericCandidate {
  readonly id: string;
  readonly profile_version: string;
  readonly runtime: string;
  readonly brain: Pin;
  readonly source: Pin;
  /** Sensor-bus pins, SDA first. Mirrors the assembly profile port resources. */
  readonly sda: number;
  readonly scl: number;
  readonly resources: readonly string[];
  readonly peripherals: readonly PeripheralOption[];
}
/** ESP32-S3-DevKitC-1. GPIO8/GPIO9 are free on that board. Unchanged. */
export const DEVKITC_CANDIDATE: NumericCandidate = {
  id: "esp32s3-bh1750-usb-v1",
  profile_version: "1.0.0",
  runtime: RUNTIME,
  brain: { id: "C-001", version: "1.0.0" },
  source: { id: "E-005", version: "1.0.0" },
  sda: 8,
  scl: 9,
  resources: ["GPIO8", "GPIO9"],
  peripherals: [
    {
      part: { id: "V-005", version: "1.0.0" },
      sensor: "bh1750",
      driver_ver: "0.1.0",
      connectors: ["hsx-i2c-4pin-v1"],
    },
  ],
};
/**
 * Freenove ESP32-S3-WROOM (N16R8). GPIO8/GPIO9 are camera data pins on this
 * board (firmware/esp32s3-camera/main/camera_runtime.c), so the sensor bus is
 * GPIO47/GPIO21 and this is a separate profile rather than an edit to the
 * DevKitC one, which stays correct for its own board.
 */
export const FREENOVE_CANDIDATE: NumericCandidate = {
  id: "freenove-esp32s3-n16r8-i2c-usb-v1",
  profile_version: "1.0.0",
  runtime: RUNTIME,
  brain: { id: "C-002", version: "1.0.0" },
  source: { id: "E-005", version: "1.1.0" },
  sda: 47,
  scl: 21,
  resources: ["GPIO47", "GPIO21"],
  peripherals: [
    {
      part: { id: "V-005", version: "1.1.0" },
      sensor: "bh1750",
      driver_ver: "0.1.0",
      connectors: ["hsx-i2c-4pin-v1"],
    },
    {
      part: { id: "P-001", version: "1.1.0" },
      sensor: "bme280",
      driver_ver: "0.1.0",
      connectors: ["hsx-i2c-4pin-v1"],
    },
    {
      // The seesaw board ships a JST PH STEMMA lead; a STEMMA-to-QT cable
      // carries the same four signals, so either port connector is accepted.
      part: { id: "P-006", version: "1.0.0" },
      sensor: "seesaw_soil",
      driver_ver: "0.1.0",
      connectors: ["stemma-i2c-ph-4pin-v1", "hsx-i2c-4pin-v1"],
    },
  ],
};
export const NUMERIC_CANDIDATES: readonly NumericCandidate[] = [
  DEVKITC_CANDIDATE,
  FREENOVE_CANDIDATE,
];
/** Retained names for the original single-board candidate. */
export const CANDIDATE = DEVKITC_CANDIDATE.id;
export const CHANNELS = SENSORS.bh1750.channels;
export interface NumericSelection {
  readonly candidate: NumericCandidate;
  readonly sensors: readonly SensorKey[];
  readonly channels: Record<string, ChannelRange>;
  readonly interval_s: number;
}
const pins = (values: readonly Pin[]) =>
  values
    .map((p) => `${p.id}@${p.version}`)
    .sort()
    .join("|");
/** The exact pin string a plan and its evidence must carry for this selection. */
export const expectedPins = (
  candidate: NumericCandidate,
  peripherals: readonly PeripheralOption[],
) => pins([candidate.brain, candidate.source, ...peripherals.map((p) => p.part)]);
const unsupported = () =>
  new Error("This accepted plan has no supported firmware compiler profile");
/** Only a precise implemented runtime/driver/wiring tuple may reach the compiler. */
export function selectNumericCandidate(
  planInput: unknown,
  metadataInput: unknown,
  spec: Spec,
): NumericSelection {
  const plan = BuildPlanV1.parse(planInput),
    metadata = BuildPlanMetadata.parse(metadataInput);
  const candidate = NUMERIC_CANDIDATES.find((c) => c.id === plan.profile.id);
  if (!candidate) throw unsupported();
  const wired = plan.wiring_graph.peripherals;
  const chosen: PeripheralOption[] = [];
  for (const edge of wired) {
    const option = candidate.peripherals.find(
      (p) => p.part.id === edge.part.id && p.part.version === edge.part.version,
    );
    if (!option || chosen.includes(option) || !option.connectors.includes(edge.connector))
      throw unsupported();
    chosen.push(option);
  }
  const resources = candidate.resources.join(",");
  const interval = spec.sense?.interval_s;
  const expected = expectedPins(candidate, chosen);
  if (
    plan.runtime !== candidate.runtime ||
    metadata.runtime !== plan.runtime ||
    plan.profile.version !== candidate.profile_version ||
    metadata.profile.id !== plan.profile.id ||
    metadata.profile.version !== plan.profile.version ||
    metadata.evidence.profile.id !== plan.profile.id ||
    metadata.evidence.profile.version !== plan.profile.version ||
    pins(plan.part_versions) !== expected ||
    pins(metadata.evidence.parts) !== expected ||
    metadata.evidence.parts.some((p) => p.status !== "active") ||
    plan.wiring_graph.brain.id !== candidate.brain.id ||
    plan.wiring_graph.brain.version !== candidate.brain.version ||
    plan.wiring_graph.source.id !== candidate.source.id ||
    plan.wiring_graph.source.version !== candidate.source.version ||
    metadata.evidence.profile.brain.id !== candidate.brain.id ||
    metadata.evidence.profile.brain.version !== candidate.brain.version ||
    metadata.evidence.profile.source.id !== candidate.source.id ||
    metadata.evidence.profile.source.version !== candidate.source.version ||
    chosen.length === 0 ||
    wired.some(
      (edge) =>
        edge.rail !== "brain" ||
        edge.resources.join(",") !== resources ||
        !metadata.evidence.profile.ports.some(
          (port) =>
            port.id === edge.port &&
            port.interface === "i2c" &&
            port.rail === "brain" &&
            port.resources.join(",") === resources &&
            port.connector === edge.connector,
        ),
    ) ||
    chosen.some((option) => {
      const driver = SENSORS[option.sensor].driver_pkg;
      const part = metadata.evidence.parts.find(
        (p) => p.id === option.part.id && p.version === option.part.version,
      );
      return (
        part?.software.driver_pkg !== driver ||
        part.software.driver_version !== option.driver_ver ||
        !metadata.evidence.compat.some(
          (c) =>
            c.brain_id === candidate.brain.id &&
            c.driver_pkg === driver &&
            c.driver_ver === option.driver_ver &&
            c.runtime_ver === candidate.runtime &&
            c.status === "passed",
        )
      );
    }) ||
    spec.connect?.transport !== "wifi" ||
    spec.power?.source !== "usb" ||
    !Number.isInteger(interval) ||
    interval! < 10 ||
    interval! > 86400
  )
    throw unsupported();
  const sensors = chosen.map((option) => option.sensor);
  const channels: Record<string, ChannelRange> = {};
  for (const sensor of sensors)
    for (const [key, range] of Object.entries(SENSORS[sensor].channels)) {
      if (channels[key]) throw unsupported();
      channels[key] = range;
    }
  return { candidate, sensors, channels, interval_s: interval! };
}
export function candidateInterval(
  planInput: unknown,
  metadataInput: unknown,
  spec: Spec,
): number {
  return selectNumericCandidate(planInput, metadataInput, spec).interval_s;
}
/** The compiler writes this over the template header before building. */
export function numericProfileHeader(selection: NumericSelection): string {
  const { candidate } = selection;
  const first = Object.keys(selection.channels)[0];
  if (!first || !/^[a-z][a-z0-9_]{0,63}$/.test(first)) throw unsupported();
  if (!/^[a-z0-9][a-z0-9-]{0,119}$/.test(candidate.id)) throw unsupported();
  const macros = Object.values(SENSORS)
    .map(
      (sensor) =>
        `#define ${sensor.macro} ${selection.sensors.some((key) => SENSORS[key].macro === sensor.macro) ? 1 : 0}`,
    )
    .join("\n");
  return `#pragma once\n/* Generated from the accepted plan's compiler candidate. */\n#define HSX_PROFILE_ID ${JSON.stringify(candidate.id)}\n#define HSX_RUNTIME ${JSON.stringify(candidate.runtime)}\n#define HSX_CHANNEL ${JSON.stringify(first)}\n#define HSX_SDA ${candidate.sda}\n#define HSX_SCL ${candidate.scl}\n${macros}\n`;
}
/** Bounded editable app layer. No arbitrary source, headers, paths or shell fragments. */
export function renderApp(interval: number): string {
  if (!Number.isInteger(interval) || interval < 10 || interval > 86400)
    throw new Error("Unsupported sample interval");
  return `#include "hsx-sdk.h"\nextern "C" void app_main(void) { hsx_run(${interval}); }\n`;
}
export function editInterval(instruction: string): number {
  const match =
    /^set (?:sample |upload )?interval to ([0-9]{1,5}) seconds$/i.exec(
      instruction.trim(),
    );
  if (!match)
    throw new Error(
      "Supported edit: Set interval to 60 seconds (10–86400 seconds)",
    );
  const value = Number(match[1]);
  renderApp(value);
  return value;
}
