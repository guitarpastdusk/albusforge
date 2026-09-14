import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { httpDeviceChatClient } from "./device-converse";

const input = {
  request_id: randomUUID(),
  tenant_id: randomUUID(),
  device_id: randomUUID(),
  actor_id: randomUUID(),
  question: "How warm has it been?",
  history: [{ role: "user" as const, text: "hi" }, { role: "assistant" as const, text: "hello" }],
};
const result = {
  request_id: input.request_id,
  device_id: input.device_id,
  reply: "It peaked at 26.4 C today.",
  mode: "model" as const,
  queries: [{ tool: "query_window" as const, channel: "temperature_c", from: "2026-09-14T00:00:00Z", to: "2026-09-14T12:00:00Z", points: 12 }],
  limitations: [],
};

describe("internal device chat client", () => {
  it("sends only the scoped request with service credentials and refuses redirects", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json(result));
    const signal = new AbortController().signal;
    await expect(httpDeviceChatClient("https://ask.internal", async () => "Bearer service", transport).converse(input, signal)).resolves.toEqual(result);
    expect(transport).toHaveBeenCalledWith(
      new URL("https://ask.internal/v1/converse"),
      expect.objectContaining({
        redirect: "error",
        signal,
        headers: { "content-type": "application/json", authorization: "Bearer service" },
        body: JSON.stringify(input),
      }),
    );
  });

  it.each([403, 404, 422, 429, 500])("never relays upstream error bodies (%i)", async (status) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response("secret SQL credentials", { status }));
    await expect(
      httpDeviceChatClient("https://ask.internal", async () => undefined, transport).converse(input, new AbortController().signal),
    ).rejects.not.toThrow("secret");
  });

  it.each([{ device_id: randomUUID() }, { request_id: randomUUID() }])("rejects a reply scoped to another question", async (delta) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...result, ...delta }));
    await expect(
      httpDeviceChatClient("https://ask.internal", async () => undefined, transport).converse(input, new AbortController().signal),
    ).rejects.toThrow("scope mismatch");
  });

  it("rejects a reply that does not match the response contract", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...result, mode: "invented" }));
    await expect(
      httpDeviceChatClient("https://ask.internal", async () => undefined, transport).converse(input, new AbortController().signal),
    ).rejects.toThrow();
  });

  it("bounds upstream response bodies", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response("x".repeat(131073)));
    await expect(
      httpDeviceChatClient("https://ask.internal", async () => undefined, transport).converse(input, new AbortController().signal),
    ).rejects.toThrow("too large");
  });

  it("does not send after abort during credential acquisition", async () => {
    const controller = new AbortController(),
      transport = vi.fn<typeof fetch>();
    const client = httpDeviceChatClient("https://ask.internal", async () => {
      controller.abort();
      return "Bearer service";
    }, transport);
    await expect(client.converse(input, controller.signal)).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
});
