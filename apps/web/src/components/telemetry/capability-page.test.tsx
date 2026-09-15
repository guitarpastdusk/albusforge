// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const mocked = vi.hoisted(() => ({ get: vi.fn(), session: vi.fn() }));
vi.mock("@/lib/api/server", () => ({ apiGet: mocked.get, orNotFound: (value: Promise<unknown>) => value }));
vi.mock("@/lib/session", () => ({ requireSession: mocked.session }));
vi.mock("./ObservationGallery", () => ({ ObservationGallery: () => <section>Camera gallery</section> }));
vi.mock("@/components/devices/DeviceConsole", () => ({ DeviceConsole: () => <section>Numeric sensor chat</section> }));
import DevicePage from "@/app/(app)/live/[deviceId]/page";
const id = "11111111-1111-4111-8111-111111111111";
const camera = { id: "camera.front", kind: "image", schema: "jpeg.v1", enabled: true, required: true, interval_s: 900, last_capture_at: null, last_received_at: null, status: "waiting" };
beforeEach(() => { mocked.get.mockReset(); mocked.session.mockResolvedValue({ tenant: { id: "tenant" } }); });
it.each([false, true])("renders camera content with numeric sections only when channels exist (mixed=%s)", async mixed => {
  mocked.get.mockImplementation(async (path: string) => {
    if (path.includes("presentation=1")) return { device: { id, status: "never_seen", last_seen_at: null, next_s: 60, revoked_at: null, health: null },
      channels: mixed ? { temperature: { unit: "C", min: -40, max: 80 } } : {}, capabilities: [camera] };
    if (path.includes("/latest")) return { device_id: id, readings: [] };
    if (path.includes("/series")) return { device_id: id, channel: "temperature", resolution: "raw", from: "2026-09-14T00:00:00Z", to: "2026-09-14T01:00:00Z", points: [], pending_rollup: false };
    throw new Error(`Unexpected request ${path}`);
  });
  const html = renderToStaticMarkup(await DevicePage({ params: Promise.resolve({ deviceId: id }), searchParams: Promise.resolve({}) }));
  expect(html).toContain("Camera gallery");
  expect(html).toContain("camera.front every 900 seconds");
  expect(html).not.toContain("Offline means no recent packet");
  if (!mixed) expect(html).not.toContain("No device health packet");
  // Numeric sections still require numeric channels.
  for (const text of ["Latest readings", "Reading history"]) {
    if (mixed) expect(html).toContain(text); else expect(html).not.toContain(text);
  }
  // The chat does not: it answers status and provisioning questions from the
  // device itself, which is exactly what a camera-only or silent device needs.
  expect(html).toContain("Numeric sensor chat");
  if (!mixed) expect(mocked.get.mock.calls.some(([path]) => String(path).includes("/series"))).toBe(false);
});
