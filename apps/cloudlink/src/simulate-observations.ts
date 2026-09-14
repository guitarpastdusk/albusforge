import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { SensorCapabilityId } from "@albusforge/schema";
import { LocalCredential, localEndpoint } from "./local.js";

const [file, origin = "http://127.0.0.1:8080", capability = "camera"] = process.argv.slice(2);
if (!file || process.argv.length > 5 || !SensorCapabilityId.safeParse(capability).success) {
  throw new Error("Usage: pnpm exec tsx src/simulate-observations.ts DEVICE_FILE [LOOPBACK_ORIGIN] [CAPABILITY]");
}
const endpoint = localEndpoint(origin);
const credential = LocalCredential.parse(JSON.parse(await readFile(file, "utf8")));
const image = await sharp({ create: { width: 320, height: 240, channels: 3, background: { r: 30, g: 120, b: 200 } } }).jpeg().toBuffer();
const observationId = randomUUID();
const sha256 = createHash("sha256").update(image).digest("hex");
const capturedAt = String(Math.floor(Date.now() / 1000));
let acknowledgment: string | undefined;
for (let attempt = 1; attempt <= 2; attempt++) {
  const response = await fetch(new URL(`/ingest/v2/devices/${credential.dev}/observations`, endpoint), {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
    headers: { authorization: `Bearer ${credential.token}`, "content-type": "image/jpeg",
      "x-observation-id": observationId, "x-capability-id": capability, "x-payload-schema": "jpeg.v1",
      "x-captured-at": capturedAt, "x-content-sha256": sha256 },
    body: new Uint8Array(image),
  });
  const text = await response.text();
  console.log(`Attempt ${attempt}: ${response.status} ${text}`);
  if (response.status !== (attempt === 1 ? 201 : 200)) { process.exitCode = 1; break; }
  const ack = JSON.parse(text);
  if (ack.observation_id !== observationId || ack.sha256 !== sha256 || ack.bytes !== image.length || ack.state !== "stored") {
    throw new Error("Server acknowledgment does not match the synthetic image");
  }
  if (attempt === 2 && text !== acknowledgment) throw new Error("Replay acknowledgment changed");
  acknowledgment = text;
}
