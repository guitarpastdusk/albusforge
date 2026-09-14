import { expect, it } from "vitest";
import { CAMERA_CAPABILITIES, CAMERA_CANDIDATE, CAMERA_CHANNELS, renderCameraApp } from "./camera-candidate";
import { compileCameraCandidate } from "./compiler";
import { FirmwareManifest } from "@albusforge/schema";
it("locks the candidate to the requested 15-minute capture cadence", () => {
  expect(renderCameraApp(900)).toContain("hsx_camera_run()");
  for (const interval of [180, 60, 901, NaN, Infinity]) expect(() => renderCameraApp(interval)).toThrow();
  expect(() => compileCameraCandidate({ build_id: "11111111-1111-4111-8111-111111111111", plan_version: 1, code_version: 1, interval_s: 60 }, "/missing")).toThrow();
});
it("serializes the fixed camera and environmental channels together", () => {
  const manifest = FirmwareManifest.parse({ v: 1, build_id: "11111111-1111-4111-8111-111111111111", plan_version: 1, code_version: 1,
    profile_id: CAMERA_CANDIDATE, runtime: "0.3.0", channels: CAMERA_CHANNELS, capabilities: CAMERA_CAPABILITIES,
    files: ["bootloader.bin", "partition-table.bin", "albusforge.bin"].map(path => ({ path, size: 1, sha256: "a".repeat(64) })),
    flash: { chip: "esp32s3", config_offset: 36864, config_size: 24576 } });
  expect(manifest.channels).toEqual(CAMERA_CHANNELS);
  expect(manifest.capabilities).toMatchObject([{ id: "camera", interval_s: 900 }, { id: "environment", kind: "measurement", interval_s: 900, channels: CAMERA_CHANNELS }]);
});
