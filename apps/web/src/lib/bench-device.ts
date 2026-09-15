import { wiringForParts } from "./provisioned-wiring";
import type { Wiring } from "./example-wiring";

/*
 * The bench device, as it actually stands.
 *
 * Every fact here was observed during the Freenove bring-up (hardware/freenove
 * and its logs, the C-002 part definition and the freenove-esp32s3-n16r8-i2c-usb-v1
 * assembly profile). It is written down rather than derived because the running
 * device does not report most of it: DeviceSetupStatus carries channels and
 * receipt times, not a board revision, a camera PID or a driver's absence.
 *
 * It is therefore a REFERENCE for the demo, not a description of whichever
 * device a page happens to be showing, and the page says so. The durable fix is
 * the provisioning profile id on the setup status, plus device health reporting
 * the rest.
 */

export interface BenchFact {
  label: string;
  value: string;
  /** A caveat that belongs with the fact, not in a footnote. */
  note?: string;
}

export const BENCH_BOARD = {
  partId: "C-002",
  name: "Freenove ESP32-S3-WROOM CAM (N16R8)",
  supplier: "DigiKey FNK0085",
  facts: [
    { label: "Silicon", value: "ESP32-S3 rev 0.2 · dual core 240 MHz" },
    { label: "Memory", value: "16 MiB quad flash · 8 MiB octal PSRAM at 80 MHz" },
    { label: "USB serial", value: "VID 1a86 / PID 55d3 · serial 5B7A116433" },
    { label: "Camera", value: "GC0308 (PID 0x009b) · 320×240 RGB565, software JPEG ≤5 fps" },
    {
      label: "MicroSD",
      value: "1 GB FAT32",
      note: "Mounted once at 960 MiB and failed with ESP_FAIL on a later boot. Unresolved, and telemetry does not need it.",
    },
  ] satisfies BenchFact[],
} as const;

/** The I2C bus the sensors share, from the assembly profile's allocated ports. */
export const BENCH_BUS = { sda: "GPIO47", scl: "GPIO21", note: "GPIO8 and GPIO9 are the camera's data pins D2 and D1 on this board." } as const;

export type SensorState = "uploading" | "detected";

export interface BenchSensor {
  address: string;
  name: string;
  partId: string;
  version: string | null;
  state: SensorState;
  detail: string;
}

/** In bus order, nearest the board last: this is the chain as it is plugged. */
export const BENCH_SENSORS: BenchSensor[] = [
  { address: "0x36", name: "Adafruit STEMMA seesaw capacitive soil sensor", partId: "P-006", version: null, state: "detected", detail: "Detected on the bus, no driver, not uploading" },
  { address: "0x77", name: "BME280 temperature, humidity, pressure", partId: "P-001", version: "1.1.0", state: "uploading", detail: "Uploading three channels" },
  { address: "0x23", name: "BH1750 ambient light", partId: "V-005", version: "1.1.0", state: "uploading", detail: "Uploading lux" },
];

export const BENCH_FIRMWARE = {
  facts: [
    { label: "Firmware", value: "ESPHome 2026.8.2 on ESP-IDF" },
    { label: "Config", value: "hardware/freenove/plant-node.yaml" },
    { label: "Installed", value: "Compiled 22:44 local, installed over OTA" },
  ] satisfies BenchFact[],
} as const;

/**
 * The bench chain as a wiring diagram, drawn through the same derivation the
 * marketplace and the provisioned-device path use — so the pins still come from
 * the assembly profile (GPIO47/GPIO21), not from anything typed in here.
 *
 * Order is the chain as it is plugged: the light sensor reaches the board, the
 * climate sensor hangs off it, and the soil sensor off that.
 */
export const BENCH_ASSEMBLY_ID = "freenove-esp32s3-n16r8-i2c-usb-v1";
export const BENCH_PART_IDS = ["C-002", "E-005", "V-005", "P-001", "P-006"] as const;

export function benchWiring(): Wiring | null {
  return wiringForParts(BENCH_PART_IDS, BENCH_ASSEMBLY_ID);
}
