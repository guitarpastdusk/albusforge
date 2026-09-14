// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DeviceProvisioning } from "@albusforge/schema";
import { DeviceConfiguration } from "./DeviceConfiguration";
import { ClaimSelfFlash } from "./ClaimSelfFlash";
import { claimSelfFlash, replaceDeviceConfiguration, revokeDeviceCredential } from "@/actions/device-provisioning";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const refresh = vi.fn(), push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push }) }));
vi.mock("@/actions/device-provisioning", () => ({ claimSelfFlash: vi.fn(), replaceDeviceConfiguration: vi.fn(), revokeDeviceCredential: vi.fn() }));
let container: HTMLDivElement, root: Root;
const tenant = "093231a1-d35d-47b8-8005-f574884703ba";
const state: DeviceProvisioning = { device_id: "6bb677e5-d5ce-4557-b90f-109e579cb629", build_id: "8e6c080d-561d-4ef3-b320-2712d4d47816", plan_version: 1, code_version: 2, credential_version: 3, created_at: "2026-09-13T12:00:00Z", handoff_expires_at: "2026-09-13T12:10:00Z", state: "configuration_ready", handoff_available: true };
const button = (name: string) => [...container.querySelectorAll("button")].find(button => button.textContent === name)!;
beforeEach(() => { vi.clearAllMocks(); container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
it("requires explicit acknowledgement before replacing or revoking and binds the tenant/version snapshot", async () => {
  vi.mocked(replaceDeviceConfiguration).mockResolvedValue({ ok: true, data: { ...state, credential_version: 4 } });
  vi.mocked(revokeDeviceCredential).mockResolvedValue({ ok: true, data: { ...state, state: "credential_revoked" } });
  await act(async () => root.render(<DeviceConfiguration provisioning={state} tenantId={tenant} mayWrite />));
  expect(button("Replace configuration").disabled).toBe(true); expect(button("Revoke device credential").disabled).toBe(true);
  await act(async () => container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[0]!.click());
  await act(async () => button("Replace configuration").click());
  expect(replaceDeviceConfiguration).toHaveBeenCalledWith(state.device_id, { expected_tenant_id: tenant, expected_version: 3, request_id: expect.any(String) });
  await act(async () => container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1]!.click());
  await act(async () => button("Revoke device credential").click());
  expect(revokeDeviceCredential).toHaveBeenCalledWith(state.device_id, { expected_tenant_id: tenant, expected_version: 3 });
});
it("never offers secret actions to viewers or revoked identities", async () => {
  await act(async () => root.render(<DeviceConfiguration provisioning={state} tenantId={tenant} mayWrite={false} />));
  expect(container.querySelector("button")).toBeNull(); expect(container.textContent).toContain("operator or admin");
  await act(async () => root.render(<DeviceConfiguration provisioning={{ ...state, state: "credential_revoked", handoff_available: false }} tenantId={tenant} mayWrite />));
  expect(container.querySelector("button")).toBeNull(); expect(container.textContent).toContain("identity is revoked");
});
it("keeps a stable claim request across a retry and never accepts browser-supplied provisioning facts", async () => {
  vi.mocked(claimSelfFlash).mockResolvedValueOnce({ ok: false, message: "Try again", refresh: false }).mockResolvedValueOnce({ ok: true, data: state });
  await act(async () => root.render(<ClaimSelfFlash tenantId={tenant} buildId={state.build_id} planVersion={1} codeVersion={2} mayWrite />));
  await act(async () => button("Register this device").click()); await act(async () => button("Register this device").click());
  const first = vi.mocked(claimSelfFlash).mock.calls[0]![0];
  expect(first).toEqual({ expected_tenant_id: tenant, build_id: state.build_id, plan_version: 1, code_version: 2, request_id: expect.any(String) });
  expect(vi.mocked(claimSelfFlash).mock.calls[1]![0]).toEqual(first); expect(push).toHaveBeenCalledWith(`/setup?device=${state.device_id}`);
});
