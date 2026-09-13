import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { httpSensorAskClient } from "./sensor-ask";
const input = { request_id: randomUUID(), tenant_id: randomUUID(), device_id: randomUUID(), actor_id: randomUUID(), question: "Mean?", channel: "temperature_c", from: "2026-09-13T10:00:00Z", to: "2026-09-13T11:00:00Z" };
const result = { request_id: input.request_id, device_id: input.device_id, channel: input.channel, answer: "Mean is 20 C", mode: "evidence_only", limitations: [], evidence: { from: input.from, to: input.to, unit: "C", count: 1, min: 20, max: 20, mean: 20, latest: { t: input.from, v: 20 } } };
describe("internal sensor Ask client", () => {
  it("sends only scoped JSON with service credentials and refuses redirects", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json(result));
    const signal = new AbortController().signal;
    await expect(httpSensorAskClient("https://ask.internal", async () => "Bearer service", transport).ask(input, signal)).resolves.toEqual(result);
    expect(transport).toHaveBeenCalledWith(new URL("https://ask.internal/v1/ask"), expect.objectContaining({ redirect: "error", signal, headers: { "content-type": "application/json", authorization: "Bearer service" }, body: JSON.stringify(input) }));
  });
  it.each([403,404,410,422,429,500])("never relays upstream error bodies (%i)", async (status) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response("secret SQL credentials", { status }));
    await expect(httpSensorAskClient("https://ask.internal", async () => undefined, transport).ask(input, new AbortController().signal)).rejects.not.toThrow("secret");
  });
  it.each([{ device_id: randomUUID() }, { request_id: randomUUID() }, { channel: "battery" }, { evidence: { ...result.evidence, from: "2026-09-12T10:00:00Z" } }])("rejects mismatched response scope", async (delta) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...result, ...delta }));
    await expect(httpSensorAskClient("https://ask.internal", async () => undefined, transport).ask(input, new AbortController().signal)).rejects.toThrow("scope mismatch");
  });
  it("bounds upstream response bodies", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response("x".repeat(65537)));
    await expect(httpSensorAskClient("https://ask.internal", async () => undefined, transport).ask(input, new AbortController().signal)).rejects.toThrow("too large");
  });
  it("does not send after abort during credential acquisition", async () => {
    const controller = new AbortController(), transport = vi.fn<typeof fetch>();
    const client = httpSensorAskClient("https://ask.internal", async () => { controller.abort(); return "Bearer service"; }, transport);
    await expect(client.ask(input, controller.signal)).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
});
