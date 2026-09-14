// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DeviceSetupStatus } from "@albusforge/schema";
import { DeviceSetupView } from "./DeviceSetupView";
import { RefreshSetup } from "./RefreshSetup";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const refresh = vi.fn();
const router = { refresh };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
let container: HTMLDivElement;
let root: Root;
let visible = true;
const setup: DeviceSetupStatus = {
  device_id: "6bb677e5-d5ce-4557-b90f-109e579cb629", checked_at: "2026-09-13T12:00:00Z", registered_at: "2026-09-12T12:00:00Z",
  state: "waiting_for_upload", packet_received: false, last_packet_at: null, upload_interval_s: 60, revoked_at: null,
  channels: [{ key: "temperature", unit: "C", latest: null }],
};
beforeEach(() => {
  vi.useFakeTimers(); refresh.mockReset(); visible = true;
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visible ? "visible" : "hidden" });
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
it("checks only visible waiting screens, pauses at 60 checks and allows explicit restart", async () => {
  await act(async () => root.render(<RefreshSetup waiting />));
  visible = false; await advance(30_000); expect(refresh).not.toHaveBeenCalled();
  visible = true; for (let i = 0; i < 61; i++) await advance(5000); expect(refresh).toHaveBeenCalledTimes(60);
  expect(container.textContent).toContain("Automatic checks paused");
  await advance(60_000); expect(refresh).toHaveBeenCalledTimes(60);
  await act(async () => container.querySelector("button")!.click());
  expect(refresh).toHaveBeenCalledTimes(61);
  await advance(5000); expect(refresh).toHaveBeenCalledTimes(62);
  await act(async () => root.render(<RefreshSetup waiting={false} />));
  await advance(30_000); expect(refresh).toHaveBeenCalledTimes(62);
});
it("keeps zero readings and distinguishes partial reception, confirmation and credential revocation", async () => {
  await act(async () => root.render(<DeviceSetupView setup={setup} />));
  expect(container.textContent).toContain("Waiting for an authenticated upload");
  expect(container.textContent).toContain("None recorded");
  const received = { ...setup, packet_received: true, channels: [{ key: "temperature", unit: "C", latest: { at: setup.checked_at, value: 0 } }] };
  await act(async () => root.render(<DeviceSetupView setup={{ ...received, state: "waiting_for_channels" }} />));
  expect(container.textContent).toContain("some channels are waiting"); expect(container.textContent).toContain("0 C");
  await act(async () => root.render(<DeviceSetupView setup={{ ...received, state: "confirmed" }} />));
  expect(container.textContent).toContain("Cloud reception confirmed");
  expect(container.textContent).toContain("does not verify physical assembly");
  expect(container.querySelector(`a[href="/live/${setup.device_id}"]`)).not.toBeNull();
  await advance(10_000); expect(refresh).not.toHaveBeenCalled();
  await act(async () => root.render(<DeviceSetupView setup={{ ...received, state: "credential_revoked", revoked_at: setup.checked_at }} />));
  expect(container.textContent).toContain("Device credential revoked");
  await advance(10_000); expect(refresh).not.toHaveBeenCalled();
});
