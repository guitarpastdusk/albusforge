import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("shares a delayed mock conversation across separately loaded action, stream and page modules", async () => {
  // Next builds the action/RSC and route-handler graphs separately. A test
  // importing both from one module cache would hide the production 404.
  vi.stubEnv("NODE_ENV", "production");
  vi.resetModules();
  const actionData = await import("./data");
  const clientId = randomUUID();
  const { build } = actionData.createBuild("A greenhouse sensor", clientId);
  expect(actionData.messages(build.build_id)?.messages).toHaveLength(1);

  vi.resetModules();
  const { mockBuildEvents } = await import("./build-events");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);
  try {
    const response = mockBuildEvents(build.build_id, controller.signal);
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let received = "";
    while (!received.includes("Good brief")) {
      const chunk = await reader.read();
      if (chunk.done) break;
      received += decoder.decode(chunk.value, { stream: true });
    }
    expect(received).toContain("event: message.created");
    expect(received).toContain("Good brief");
    expect(received).toContain('"spec_version":1');

    vi.resetModules();
    const pageData = await import("./data");
    expect(pageData.buildDetail(build.build_id)?.spec_version).toBe(1);
    expect(pageData.messages(build.build_id)?.messages).toHaveLength(2);
    expect(pageData.createBuild("A greenhouse sensor", clientId)).toMatchObject({
      build: { build_id: build.build_id }, replayed: true,
    });
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
});
