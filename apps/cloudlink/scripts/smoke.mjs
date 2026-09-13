/* global process, fetch, AbortSignal, console */
import assert from "node:assert/strict";
const origin = process.env.SMOKE_ORIGIN ?? "http://127.0.0.1:8080";
const ts = Math.floor(Date.now() / 1000);
const payload = { v: 1, dev: "22222222-2222-4222-8222-222222222222", seq: 1, ts,
  r: [{ c: "temperature_c", t: -60, v: 4.2 }], st: { up_s: 60, health: ["OK"] } };
const post = (body, token = "A".repeat(43)) => fetch(`${origin}/ingest/v1`, { method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
for (let i = 0; i < 2; i++) {
  const response = await post(payload);
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { ok: 1, next_s: 300, cmd: [] });
}
assert.equal((await post({ ...payload, st: { up_s: 61, health: ["OK"] } })).status, 409);
assert.equal((await post(payload, "B".repeat(43))).status, 401);
assert.equal((await fetch(`${origin}/v1/parts`)).status, 404);
console.log("cloudlink image: durable ingestion, retry, conflict and auth smoke passed");
