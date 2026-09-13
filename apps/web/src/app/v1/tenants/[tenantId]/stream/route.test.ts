import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GET } from "./route";

vi.mock("@/lib/api/id-token.server", () => ({ idToken: vi.fn(async () => "test-token") }));

beforeEach(() => {
  vi.stubEnv("API_MODE", "live");
  vi.stubEnv("GATEWAY_INTERNAL_URL", "https://gateway.example");
  vi.stubEnv("GATEWAY_INTERNAL_AUTH", "none");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("proxies only the tenant and devices query, preserving stream identity and cancellation", async () => {
  const upstream = vi.fn(async () => new Response("event: reading\ndata: {}\n\n", { headers: { "content-type": "text/event-stream" } }));
  vi.stubGlobal("fetch", upstream);
  const request = new Request("http://localhost/v1/tenants/ten_fern/stream?devices=bed-a,bed-b&redirect=https://bad.example", { headers: { "last-event-id": "cursor-12", cookie: "__Host-albus_session=sess; tracking=bad" } });
  const response = await GET(request, { params: Promise.resolve({ tenantId: "ten_fern" }) });
  const [url, init] = upstream.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://gateway.example/v1/tenants/ten_fern/stream?devices=bed-a%2Cbed-b");
  expect(init.signal).toBe(request.signal);
  expect(init.redirect).toBe("error");
  expect(init.headers).toMatchObject({ "last-event-id": "cursor-12", cookie: "__Host-albus_session=sess" });
  expect(await response.text()).toContain("event: reading");
});

it.each([401, 403, 404, 501, 503])("passes gateway %s through without synthetic fallback", async (status) => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("not available", { status })));
  const response = await GET(new Request("http://localhost/v1/tenants/ten_fern/stream"), { params: Promise.resolve({ tenantId: "ten_fern" }) });
  expect(response.status).toBe(status);
  expect(await response.text()).toBe("not available");
});

it("refuses mock mode on Cloud Run before opening a stream", async () => {
  vi.stubEnv("API_MODE", "mock");
  vi.stubEnv("K_SERVICE", "web-test");
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(GET(new Request("http://localhost/v1/tenants/ten_fern/stream"), { params: Promise.resolve({ tenantId: "ten_fern" }) })).rejects.toThrow("not allowed on Cloud Run");
  expect(fetch).not.toHaveBeenCalled();
});
