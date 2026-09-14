import { expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { compileCameraCandidate, sha256 } from "./compiler";
import { CAMERA_CANDIDATE } from "./camera-candidate";
import { FirmwareManifest } from "@albusforge/schema";

it.skipIf(process.env.FIRMWARE_CAMERA_COMPILER !== "1")("compiles the locked native camera, verifies 16 MiB boot header and reviewed partition layout", async () => {
  const result = await compileCameraCandidate({ build_id: "00000000-0000-4000-8000-000000000000", plan_version: 1, code_version: 1, interval_s: 900 },
    fileURLToPath(new URL("../../../firmware/esp32s3-camera", import.meta.url)));
  const manifest = FirmwareManifest.parse(JSON.parse(result.manifestBytes));
  expect(manifest.profile_id).toBe(CAMERA_CANDIDATE);
  expect(manifest.channels).toEqual({});
  expect(manifest.capabilities?.[0]).toMatchObject({ id: "camera", interval_s: 900, kind: "image", max_width: 320, max_height: 240 });
  expect(result.manifest_digest).toBe(sha256(result.manifestBytes));
  for (const file of manifest.files) {
    expect(result.files.get(file.path)?.length).toBe(file.size);
    expect(sha256(result.files.get(file.path)!)).toBe(file.sha256);
  }
  const bootloader = result.files.get("bootloader.bin")!;
  expect(bootloader[0]).toBe(0xe9);
  expect(bootloader[3]! >> 4).toBe(4); // ESP image header flash-size code 4 = 16 MiB.
  const partitions = result.files.get("partition-table.bin")!;
  const entries: Array<{ type: number; subtype: number; offset: number; size: number }> = [];
  for (let offset = 0; offset + 32 <= partitions.length && partitions.readUInt16LE(offset) === 0x50aa; offset += 32) {
    entries.push({ type: partitions[offset + 2]!, subtype: partitions[offset + 3]!, offset: partitions.readUInt32LE(offset + 4), size: partitions.readUInt32LE(offset + 8) });
  }
  expect(entries).toContainEqual({ type: 1, subtype: 2, offset: 0x9000, size: 0x6000 });
  expect(entries).toContainEqual({ type: 0, subtype: 0, offset: 0x10000, size: 0x600000 });
  expect(result.files.get("albusforge.bin")!.length).toBeLessThan(0x600000);
  expect(result.bundle.subarray(0, 2).toString()).toBe("PK");
}, 900_000);
