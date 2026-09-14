import { beforeEach, expect, it, vi } from "vitest";
const mocked = vi.hoisted(() => ({ proxy: vi.fn() }));
vi.mock("@/lib/api/gateway-stream.server", () => ({ proxyGatewayStream: mocked.proxy }));
import { GET } from "./route";
const params = { deviceId: "11111111-1111-4111-8111-111111111111", capabilityId: "camera.front", observationId: "22222222-2222-4222-8222-222222222222" };
beforeEach(() => { mocked.proxy.mockReset(); });
it("passes only validated image identity to the authenticated stream proxy and prevents caching", async () => {
  mocked.proxy.mockResolvedValue(new Response("image bytes", { headers: { "content-type": "image/jpeg", "cache-control": "public,max-age=3600" } }));
  const request = new Request("http://localhost/image");
  const response = await GET(request, { params: Promise.resolve(params) });
  expect(mocked.proxy).toHaveBeenCalledWith(`/v1/devices/${params.deviceId}/capabilities/camera.front/images/${params.observationId}/content`, request, "image/jpeg");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(await response.text()).toBe("image bytes");
});
it("rejects invalid paths without proxying and rejects success responses with another MIME", async () => {
  expect((await GET(new Request("http://localhost/image"), { params: Promise.resolve({ ...params, capabilityId: "../../secret" }) })).status).toBe(404);
  expect(mocked.proxy).not.toHaveBeenCalled();
  mocked.proxy.mockResolvedValue(new Response("html", { headers: { "content-type": "text/html" } }));
  expect((await GET(new Request("http://localhost/image"), { params: Promise.resolve(params) })).status).toBe(503);
});
it("preserves expiration and authorization failures without exposing public caching", async () => {
  mocked.proxy.mockResolvedValue(new Response("Expired", { status: 410 }));
  const response = await GET(new Request("http://localhost/image"), { params: Promise.resolve(params) });
  expect(response.status).toBe(410); expect(response.headers.get("cache-control")).toBe("private, no-store");
});
