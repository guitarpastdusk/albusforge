import { expect, it } from "vitest";
import { CAMERA_CAPABILITIES, CAMERA_CANDIDATE, renderCameraApp } from "./camera-candidate";
import { compileCameraCandidate } from "./compiler";
import { FirmwareManifest } from "@albusforge/schema";
it("locks the candidate to the requested 15-minute capture cadence", () => {
  expect(renderCameraApp(900)).toContain("hsx_camera_run()");
  for (const interval of [180, 60, 901, NaN, Infinity]) expect(() => renderCameraApp(interval)).toThrow();
  expect(() => compileCameraCandidate({ build_id: "11111111-1111-4111-8111-111111111111", plan_version: 1, code_version: 1, interval_s: 60 }, "/missing")).toThrow();
});
it("serializes an image-only candidate without adding numeric channels", () => {
  const manifest = FirmwareManifest.parse({ v: 1, build_id: "11111111-1111-4111-8111-111111111111", plan_version: 1, code_version: 1,
    profile_id: CAMERA_CANDIDATE, runtime: "0.2.0", channels: {}, capabilities: CAMERA_CAPABILITIES,
    files: ["bootloader.bin", "partition-table.bin", "albusforge.bin"].map(path => ({ path, size: 1, sha256: "a".repeat(64) })),
    flash: { chip: "esp32s3", config_offset: 36864, config_size: 24576 } });
  expect(manifest.channels).toEqual({}); expect(manifest.capabilities?.[0]?.interval_s).toBe(900);
});
