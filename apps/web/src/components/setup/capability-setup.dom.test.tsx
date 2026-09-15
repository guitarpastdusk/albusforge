// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DeviceSetupStatus } from "@albusforge/schema";
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
import { DeviceSetupView } from "./DeviceSetupView";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
const setup: DeviceSetupStatus = {
  device_id: "11111111-1111-4111-8111-111111111111", checked_at: "2026-09-14T12:00:00Z", registered_at: "2026-09-14T11:00:00Z",
  state: "waiting_for_capabilities", packet_received: true, last_packet_at: "2026-09-14T12:00:00Z", upload_interval_s: 60, revoked_at: null, channels: [],
  capabilities: [{ id: "camera.front", kind: "image", schema: "jpeg.v1", enabled: true, required: true, interval_s: 900, last_capture_at: null, last_received_at: null, status: "waiting" }],
};
beforeEach(() => { vi.useFakeTimers(); refresh.mockReset(); Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" }); container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });
it("shows required-camera waiting and degraded states without empty numeric sections", async () => {
  await act(async () => root.render(<DeviceSetupView setup={setup} />));
  expect(container.textContent).toContain("Some sensors are still waiting");
  expect(container.textContent).toContain("camera.front"); expect(container.textContent).toContain("every 900 seconds");
  expect(container.textContent).not.toContain("Registered channels");
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => root.render(<DeviceSetupView setup={{ ...setup, state: "degraded", capabilities: [{ ...setup.capabilities![0]!, status: "stale" }] }} />));
  expect(container.textContent).toContain("Reception needs attention"); expect(container.textContent).toContain("stale");
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(refresh).toHaveBeenCalledTimes(1);
});

it("shows camera receipts and cadence without claiming an absent numeric packet is the latest upload", async () => {
  await act(async () => root.render(<DeviceSetupView setup={{ ...setup, state: "confirmed", packet_received: false, last_packet_at: null,
    capabilities: [{ ...setup.capabilities![0]!, last_capture_at: setup.checked_at, last_received_at: setup.checked_at, status: "healthy" }] }} />));
  expect(container.textContent).toContain("Last accepted upload");
  expect(container.textContent).toContain("2026-09-14T12:00:00.000Z");
  expect(container.textContent).not.toContain("None recorded");
  expect(container.textContent).toContain("camera.front: 900 seconds");
  expect(container.textContent).not.toContain("60 seconds");
});
