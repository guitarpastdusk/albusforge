// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { z } from "zod";
import { TelemetryDeviceDetail } from "@albusforge/schema";
import { ApiRequestError } from "@/lib/api/core";
const mocked = vi.hoisted(() => ({ get: vi.fn(), rethrow: vi.fn() }));
vi.mock("@/lib/api/server", () => ({ apiGet: mocked.get }));
vi.mock("next/navigation", () => ({ unstable_rethrow: mocked.rethrow }));
import { ObservationGallery } from "./ObservationGallery";
const id = "11111111-1111-4111-8111-111111111111";
const observation = "22222222-2222-4222-8222-222222222222";
const time = "2026-09-14T12:00:00.000Z";
const capabilities: NonNullable<z.infer<typeof TelemetryDeviceDetail>["capabilities"]> = ["camera.front", "camera.rear"].map(name => ({
  id: name, kind: "image", schema: "jpeg.v1", enabled: true, required: true, interval_s: 900,
  last_capture_at: time, last_received_at: time, status: "healthy",
}));
const picture = { device_id: id, capability_id: "camera.front", observation_id: observation, kind: "image", schema: "jpeg.v1", sha256: "a".repeat(64), bytes: 100,
  width: 320, height: 240, captured_at: time, received_at: time, expires_at: "2026-10-14T12:00:00.000Z" };
beforeEach(() => { mocked.get.mockReset(); mocked.rethrow.mockReset(); });
it("renders private raw image routes without an optimizer, credentials or public storage URLs", async () => {
  mocked.get.mockResolvedValue({ images: [picture], next_cursor: "next-token" });
  const html = renderToStaticMarkup(await ObservationGallery({ deviceId: id, capabilities, search: {} }));
  const document = new DOMParser().parseFromString(html, "text/html");
  expect(document.querySelector("img")?.getAttribute("src")).toBe(`/v1/devices/${id}/capabilities/camera.front/images/${observation}/content`);
  expect(html).not.toContain("/_next/image"); expect(html).not.toContain("storage.googleapis.com"); expect(html).not.toContain("token=");
  expect(document.querySelector('nav a[aria-current="page"]')?.textContent).toContain("camera.front");
  expect(html).toContain("15 minutes"); expect(html).toContain("30 days from capture");
  expect(document.querySelector('a[href*="image_cursor"]')?.getAttribute("href")).toBe(`/live/${id}?camera=camera.front&image_cursor=next-token`);
});
it("selects an independent camera, binds pagination to it, and resets cursors for unknown camera selection", async () => {
  mocked.get.mockResolvedValue({ images: [], next_cursor: null });
  const html = renderToStaticMarkup(await ObservationGallery({ deviceId: id, capabilities, search: { camera: "camera.rear", image_cursor: "opaque+cursor" } }));
  expect(mocked.get.mock.calls[0]![0]).toContain("/camera.rear/images?limit=24&cursor=opaque%2Bcursor");
  expect(html).toContain("No retained pictures yet");
  const document = new DOMParser().parseFromString(html, "text/html");
  expect(document.querySelector('a[aria-current="page"]')?.textContent).toContain("camera.rear");
  expect(document.querySelector('a[href*="camera.front"]')?.getAttribute("href")).toBe(`/live/${id}?camera=camera.front`);
  await ObservationGallery({ deviceId: id, capabilities, search: { camera: "foreign", image_cursor: "foreign-cursor" } });
  expect(mocked.get.mock.calls[1]![0]).toBe(`/v1/devices/${id}/capabilities/camera.front/images?limit=24`);
});
it.each([[401, "workspace access changed"], [403, "workspace access changed"], [400, "history link is no longer valid"], [503, "temporarily unavailable"]])("shows an actionable gallery error for HTTP %i", async (status, expected) => {
  mocked.get.mockRejectedValue(new ApiRequestError(Number(status), "TEST", "private service detail"));
  const html = renderToStaticMarkup(await ObservationGallery({ deviceId: id, capabilities, search: {} }));
  expect(html).toContain(expected); expect(html).toContain('role="alert"'); expect(html).not.toContain("private service detail");
});
it("omits gallery and performs no image request when a device has no camera", async () => {
  expect(await ObservationGallery({ deviceId: id, capabilities: [], search: {} })).toBeNull();
  expect(mocked.get).not.toHaveBeenCalled();
});
