import { readFile } from "node:fs/promises";
import { z } from "zod";
import { LocalCredential, localEndpoint } from "./local.js";

const [file, origin = "http://127.0.0.1:8080", seqInput = "1"] = process.argv.slice(2);
if (!file || process.argv.length > 5) throw new Error("Usage: pnpm --filter gateway telemetry:simulate DEVICE_FILE [HTTP_ORIGIN] [SEQUENCE]");
const endpoint = localEndpoint(origin);
const credential = LocalCredential.parse(JSON.parse(await readFile(file, "utf8")));
const seq = z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).parse(seqInput);
const ts = Math.floor(Date.now() / 1000);
const body = JSON.stringify({ v: 1, dev: credential.dev, seq, ts,
  r: [{ c: "temperature_c", t: -60, v: 4.2 }, { c: "humidity_pct", t: -60, v: 51 }],
  st: { rssi: -62, up_s: 60, health: ["OK"] },
});
// Send exactly the same envelope twice to demonstrate safe lost-ack retries.
for (let attempt = 1; attempt <= 2; attempt++) {
  const response = await fetch(new URL("/ingest/v1", endpoint), {
    method: "POST", headers: { authorization: `Bearer ${credential.token}`, "content-type": "application/json" },
    body, redirect: "error", signal: AbortSignal.timeout(15_000),
  });
  console.log(`Attempt ${attempt}: ${response.status} ${await response.text()}`);
  if (response.status !== 202) { process.exitCode = 1; break; }
}
