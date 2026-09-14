/** Explicit local build command; this does not publish or approve a profile. */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileCameraCandidate } from "./compiler";
const [outputInput, build_id, templateInput] = process.argv.slice(2);
if (!outputInput || !build_id || process.argv.length > 5) throw new Error("Usage: tsx src/compile-camera.ts NEW_OUTPUT_DIRECTORY BUILD_UUID [PREPARED_CAMERA_TEMPLATE]");
const output = resolve(outputInput);
const template = templateInput ? resolve(templateInput) : fileURLToPath(new URL("../../../firmware/esp32s3-camera", import.meta.url));
await mkdir(output); // Refuse to overwrite a previous review artifact.
const result = await compileCameraCandidate({ build_id, plan_version: 1, code_version: 1, interval_s: 900 }, template);
for (const [name, bytes] of result.files) await writeFile(`${output}/${name}`, bytes);
await writeFile(`${output}/manifest.json`, result.manifestBytes);
await writeFile(`${output}/firmware.zip`, result.bundle);
await writeFile(`${output}/app.cpp`, result.source);
console.log(JSON.stringify({ output, manifest_digest: result.manifest_digest, profile_id: result.manifest.profile_id, files: result.manifest.files }));
