// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { DeviceChat } from "./DeviceChat";
import { askDevice } from "@/actions/devices";
vi.mock("@/actions/devices", () => ({ askDevice: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("asks about the selected sensor channel/window and shows the evidence-bearing reply", async () => {
  vi.mocked(askDevice).mockResolvedValue({ ok: true, data: { id: "a", role: "assistant", text: "Mean 21 C. Evidence: 2 readings.", created_at: "2026-09-13T12:00:00Z" } });
  const container = document.createElement("div"); document.body.appendChild(container); const root = createRoot(container);
  try {
    await act(async () => root.render(<DeviceChat deviceId="sensor" greeting="Stored readings" channels={[{ key: "soil", label: "soil", unit: "%" }, { key: "temperature_c", label: "temperature_c", unit: "C" }]} />));
    const select = container.querySelector<HTMLSelectElement>('[aria-label="Sensor channel"]')!;
    await act(async () => { select.value = "temperature_c"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    const input = container.querySelector<HTMLInputElement>('input[name="question"]')!;
    await act(async () => { input.value = "Mean?"; container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(askDevice).toHaveBeenCalledWith("sensor", "Mean?", expect.objectContaining({ channel: "temperature_c" }));
    const scope = vi.mocked(askDevice).mock.calls[0]![2]!;
    expect(Date.parse(scope.to) - Date.parse(scope.from)).toBeGreaterThanOrEqual(3600000);
    expect(container.textContent).toContain("Evidence: 2 readings");
    expect(container.textContent).toContain("not sent to the model");
  } finally { await act(async () => root.unmount()); container.remove(); }
});
