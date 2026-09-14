// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { reconcileWorkspace } from "@/actions/workspace";
import { WorkspaceAdmission } from "./WorkspaceAdmission";
import { WorkspaceBoundary, useWorkspaceTransition } from "./WorkspaceBoundary";
import { WorkspaceIdentity } from "./WorkspaceIdentity";
vi.mock("@/actions/workspace", () => ({ reconcileWorkspace: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const snapshot = { userId: "user-a", tenantId: "tenant-a" };
let root: Root;
let container: HTMLDivElement;
beforeEach(() => { vi.mocked(reconcileWorkspace).mockReset(); container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });
it("does not admit streamed tenant children until their rendered snapshot is confirmed", async () => {
  let resolve!: (value: { ok: true; data: boolean }) => void;
  vi.mocked(reconcileWorkspace).mockImplementation(() => new Promise(done => { resolve = done; }));
  await act(async () => root.render(<WorkspaceAdmission snapshot={snapshot}><p>Private A</p></WorkspaceAdmission>));
  expect(container.textContent).not.toContain("Private A");
  expect(reconcileWorkspace).toHaveBeenCalledWith(snapshot);
  await act(async () => resolve({ ok: true, data: true }));
  expect(container.textContent).toContain("Private A");
});
it("keeps old content unmounted on a changed or uncertain session", async () => {
  const replace = vi.spyOn(window.location, "replace").mockImplementation(() => {});
  vi.mocked(reconcileWorkspace).mockResolvedValue({ ok: true, data: false });
  await act(async () => root.render(<WorkspaceAdmission snapshot={snapshot}><p>Private A</p></WorkspaceAdmission>));
  expect(replace).toHaveBeenCalledWith("/projects");
  expect(container.textContent).not.toContain("Private A");
  vi.mocked(reconcileWorkspace).mockResolvedValue({ ok: false, message: "Reload to recover" });
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(container.textContent).toContain("Reload to recover");
  expect(container.textContent).not.toContain("Private A");
});
function Intent() { const state = useWorkspaceTransition(); return <p>{state?.expectedTenant === undefined ? "Not admitted" : state.expectedTenant ?? "Anonymous"}</p>; }
it("binds new-build intent to the confirmed rendered header and removes admission on failed focus reconciliation", async () => {
  vi.mocked(reconcileWorkspace).mockResolvedValue({ ok: true, data: true });
  await act(async () => root.render(<WorkspaceBoundary><WorkspaceIdentity snapshot={snapshot} /><Intent /></WorkspaceBoundary>));
  expect(container.textContent).toContain("tenant-a");
  vi.mocked(reconcileWorkspace).mockRejectedValue(new Error("private upstream details"));
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(container.textContent).toContain("Not admitted");
  expect(container.textContent).not.toContain("private upstream details");
  expect(container.querySelector("button")?.textContent).toBe("Reload workspace");
});
