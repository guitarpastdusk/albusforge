import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { proxyGatewayStream } from "./gateway-stream.server";

vi.mock("./id-token.server", () => ({ idToken: vi.fn().mockResolvedValue("test-internal-token") }));

const servers: ReturnType<typeof createServer>[] = [];
async function listen(handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing test listener");
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  })));
});

it("streams without waiting for EOF, forwards only intended headers and cancels on disconnect", async () => {
  let incoming: IncomingMessage | undefined;
  let closed!: () => void;
  const disconnected = new Promise<void>((resolve) => { closed = resolve; });
  const gateway = await listen((request, response) => {
    incoming = request;
    response.on("close", closed);
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write("event: build.updated\ndata: {}\n\n");
    // Leave it open: buffering the response would hang this test.
  });
  vi.stubEnv("GATEWAY_INTERNAL_URL", gateway);
  vi.stubEnv("GATEWAY_INTERNAL_AUTH", "metadata");
  vi.stubEnv("API_MODE", "live");
  vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
  const controller = new AbortController();
  try {
    const response = await proxyGatewayStream("/v1/builds/bld_1/events", new Request("http://portal.test/v1/builds/bld_1/events", {
      signal: controller.signal,
      headers: {
        host: "portal.test", "last-event-id": "msg_7", "x-forwarded-for": "198.51.100.2, 127.0.0.1",
        cookie: "theme=dark; __Host-albus_session=session; __Host-albus_anon=owner",
      },
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("event: build.updated");
    expect(incoming?.url).toBe("/v1/builds/bld_1/events");
    expect(incoming?.headers).toMatchObject({
      accept: "text/event-stream", "last-event-id": "msg_7",
      "x-albus-internal-auth": "Bearer test-internal-token", "x-albus-original-host": "portal.test",
      "x-albus-client-ip": "198.51.100.2", cookie: "__Host-albus_session=session; __Host-albus_anon=owner",
    });
    controller.abort();
    await disconnected;
  } finally {
    controller.abort();
  }
});

it.each([301, 302, 303, 307, 308])("refuses a %i redirect without sending the internal token to another origin", async (status) => {
  let redirectedRequests = 0;
  const otherOrigin = await listen((_request, response) => {
    redirectedRequests += 1;
    response.end("unexpected redirected request");
  });
  const gateway = await listen((_request, response) => {
    response.writeHead(status, { location: `${otherOrigin}/collect` });
    response.end();
  });
  vi.stubEnv("GATEWAY_INTERNAL_URL", gateway);
  vi.stubEnv("GATEWAY_INTERNAL_AUTH", "metadata");
  vi.stubEnv("API_MODE", "live");

  const response = await proxyGatewayStream("/v1/builds/bld_1/events", new Request("http://portal.test/v1/builds/bld_1/events"));
  expect(response.status).toBe(502);
  expect(response.headers.get("location")).toBeNull();
  expect(redirectedRequests).toBe(0);
});
