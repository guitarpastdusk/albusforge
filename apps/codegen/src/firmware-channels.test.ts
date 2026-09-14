import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { SENSORS } from "./candidate";
/** The device and the manifest must agree on channel identity, or ingest
 * rejects packets the device has already spent a sequence number on. */
it("matches the firmware channel table exactly", () => {
  const header = readFileSync(
    new URL("../../../firmware/esp32s3/main/include/hsx-channels.h", import.meta.url),
    "utf8",
  );
  const macro = (name: string) => {
    const match = new RegExp(`^#define ${name}\\s+(.+)$`, "m").exec(header);
    expect(match, name).not.toBeNull();
    return match![1]!.trim();
  };
  const declared = new Set(
    [...header.matchAll(/^#define HSX_CH_([A-Z0-9_]+)\s/gm)].map((m) => m[1]!),
  );
  const channels = Object.values(SENSORS).flatMap((sensor) => Object.entries(sensor.channels));
  expect(channels.length).toBe(declared.size);
  for (const [key, range] of channels) {
    const suffix = key.toUpperCase();
    expect(declared.has(suffix), key).toBe(true);
    expect(macro(`HSX_CH_${suffix}`)).toBe(JSON.stringify(key));
    expect(macro(`HSX_UNIT_${suffix}`)).toBe(JSON.stringify(range.unit));
    expect(Number(macro(`HSX_MIN_${suffix}`).replace(/f$/, ""))).toBe(range.min);
    expect(Number(macro(`HSX_MAX_${suffix}`).replace(/f$/, ""))).toBe(range.max);
  }
  // The committed template header is the DevKitC candidate and must stay so.
  const profile = readFileSync(
    new URL("../../../firmware/esp32s3/main/include/hsx-profile.h", import.meta.url),
    "utf8",
  );
  expect(profile).toContain('#define HSX_PROFILE_ID "esp32s3-bh1750-usb-v1"');
  expect(profile).toContain("#define HSX_SDA 8");
  expect(profile).toContain("#define HSX_SENSOR_BH1750 1");
});
