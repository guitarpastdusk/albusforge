import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLIENT_IP_HEADER, INTERNAL_AUTH_HEADER, ORIGINAL_HOST_HEADER } from "./gateway-headers.server";

vi.mock("./id-token.server", () => ({ idToken: vi.fn(async () => "id-token-abc") }));

const { idToken } = await import("./id-token.server");
const { proxyGatewayStream } = await import("./gateway-stream.server");

const PATH = "/v1/builds/bld_1/events";

const upstream = (body: string, status = 200, contentType = "text/event-stream") =>
  vi.fn(async () => new Response(body, { status, headers: { "content-type": contentType } }));

const incoming = (headers: Record<string, string> = {}) =>
  new Request("https://albusforge.ai" + PATH, {
    headers: {
      host: "albusforge.ai",
      "x-forwarded-for": "203.0.113.7, 130.211.0.1",
      cookie: "theme=dark; __Host-albus_anon=anon-1; __Host-albus_session=sess-1",
      ...headers,
    },
  });

/** The fetch the helper makes: its URL and headers. */
const sent = (fetchMock: ReturnType<typeof upstream>) => {
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  return { url, headers: init.headers as Record<string, string>, init };
};

beforeEach(() => {
  vi.stubEnv("GATEWAY_INTERNAL_URL", "https://gateway-abc.run.app/");
  vi.stubEnv("GATEWAY_INTERNAL_AUTH", "metadata");
  vi.stubEnv("API_MODE", "live");
  vi.mocked(idToken).mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("proxyGatewayStream", () => {
  it("calls gateway with the internal token, the original host, the client IP and only the allowlisted cookies", async () => {
    const fetchMock = upstream("retry: 3000\n\n");
    vi.stubGlobal("fetch", fetchMock);

    const response = await proxyGatewayStream(PATH, incoming());

    const { url, headers, init } = sent(fetchMock);
    // The trailing slash on GATEWAY_INTERNAL_URL must not double up.
    expect(url).toBe("https://gateway-abc.run.app" + PATH);
    expect(idToken).toHaveBeenCalledWith("https://gateway-abc.run.app");
    expect(headers[INTERNAL_AUTH_HEADER]).toBe("Bearer id-token-abc");
    expect(headers[ORIGINAL_HOST_HEADER]).toBe("albusforge.ai");
    expect(headers[CLIENT_IP_HEADER]).toBe("203.0.113.7");
    expect(headers.accept).toBe("text/event-stream");
    expect(headers.cookie).toBe("__Host-albus_session=sess-1; __Host-albus_anon=anon-1");
    expect(headers.cookie).not.toContain("theme");
    expect(init.cache).toBe("no-store");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("retry: 3000\n\n");
  });

  it("passes Last-Event-ID through, so a reconnect resumes where it stopped", async () => {
    const fetchMock = upstream("");
    vi.stubGlobal("fetch", fetchMock);

    await proxyGatewayStream(PATH, incoming({ "last-event-id": "1757766000123456.abc" }));
    expect(sent(fetchMock).headers["last-event-id"]).toBe("1757766000123456.abc");

    const without = upstream("");
    vi.stubGlobal("fetch", without);
    await proxyGatewayStream(PATH, incoming());
    expect(sent(without).headers).not.toHaveProperty("last-event-id");
  });

  it("GATEWAY_INTERNAL_AUTH=none skips the ID token (a gateway running locally without auth)", async () => {
    vi.stubEnv("GATEWAY_INTERNAL_AUTH", "none");
    const fetchMock = upstream("");
    vi.stubGlobal("fetch", fetchMock);

    await proxyGatewayStream(PATH, incoming());
    expect(idToken).not.toHaveBeenCalled();
    expect(sent(fetchMock).headers).not.toHaveProperty(INTERNAL_AUTH_HEADER);
  });

  it("passes gateway's status through, so a 404 for a build that isn't yours stays a 404", async () => {
    vi.stubGlobal("fetch", upstream('{"error":{"code":"not_found","message":"build not found"}}', 404, "application/json"));

    const response = await proxyGatewayStream(PATH, incoming());
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("application/json");
  });

  it("answers without calling gateway when it isn't configured", async () => {
    const fetchMock = upstream("");
    vi.stubGlobal("fetch", fetchMock);

    vi.stubEnv("GATEWAY_INTERNAL_URL", "");
    expect((await proxyGatewayStream(PATH, incoming())).status).toBe(503);

    vi.stubEnv("GATEWAY_INTERNAL_URL", "https://gateway-abc.run.app");
    vi.stubEnv("GATEWAY_INTERNAL_AUTH", "sometimes");
    expect((await proxyGatewayStream(PATH, incoming())).status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
