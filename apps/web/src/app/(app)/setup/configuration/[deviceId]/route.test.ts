import { randomBytes, randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/lib/api/core";
vi.mock("@/lib/api/server", () => ({ apiMutationAction: vi.fn() }));
vi.mock("next/navigation", () => ({ unstable_rethrow: vi.fn() }));
const { apiMutationAction } = await import("@/lib/api/server");
const { POST } = await import("./route");
const id = randomUUID(), tenant = randomUUID();
const request = (origin = "http://localhost") => new Request(`http://localhost/setup/configuration/${id}`, { method: "POST", headers: { origin, host: "localhost", "content-type": "application/json" }, body: JSON.stringify({ expected_tenant_id: tenant, expected_version: 1 }) });
beforeEach(() => { vi.mocked(apiMutationAction).mockReset(); });
it("returns the secret only in a private POST attachment after origin validation", async () => {
  const token = randomBytes(32).toString("base64url"); vi.mocked(apiMutationAction).mockResolvedValue({ token });
  const response = await POST(request(), { params: Promise.resolve({ deviceId: id }) });
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("content-disposition")).toContain("attachment");
  expect((await response.json()).token).toBe(token);
  expect(apiMutationAction).toHaveBeenCalledWith("POST", `/v1/devices/${id}/configuration`, expect.anything(), { expected_tenant_id: tenant, expected_version: 1 });
  vi.mocked(apiMutationAction).mockClear();
  expect((await POST(request("https://evil.example"), { params: Promise.resolve({ deviceId: id }) })).status).toBe(403); expect(apiMutationAction).not.toHaveBeenCalled();
});
it("returns safe recovery messages without echoing upstream secret-bearing failure text", async () => {
  vi.mocked(apiMutationAction).mockImplementation(async () => { throw new ApiRequestError(410, "HANDOFF_UNAVAILABLE", "private upstream text"); });
  const response = await POST(request(), { params: Promise.resolve({ deviceId: id }) });
  expect(response.status).toBe(410); expect(await response.text()).not.toContain("private upstream text");
});
