// @vitest-environment happy-dom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { switchWorkspace } from "@/actions/workspace";
import { WorkspaceBoundary, WorkspaceContent } from "./WorkspaceBoundary";
import { WorkspaceControl } from "./WorkspaceControl";
vi.mock("@/actions/workspace", () => ({ switchWorkspace: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const A = { id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", name: "Personal", role: "admin" as const, slug: null };
const B = { id: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb", name: "Team", role: "viewer" as const, slug: null };
let root: Root;let container: HTMLDivElement;const closed = vi.fn();
function TenantData() { useEffect(() => () => { closed(); }, []);return <p>Private tenant data</p>; }
async function render(multiple = true, hostScoped = false) { await act(async () => root.render(<WorkspaceBoundary><WorkspaceControl workspace={A} memberships={multiple ? [A, B] : [A]} hostScoped={hostScoped} /><WorkspaceContent><TenantData /></WorkspaceContent></WorkspaceBoundary>)); }
beforeEach(() => { vi.mocked(switchWorkspace).mockReset();closed.mockReset();localStorage.clear();container = document.createElement("div");document.body.appendChild(container);root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount());container.remove(); });
async function submit() { await act(async () => { const select = container.querySelector("select")!;select.value=B.id;select.dispatchEvent(new Event("change", { bubbles: true })); });await act(async () => container.querySelector<HTMLButtonElement>('button[type="submit"]')!.click()); }
describe("workspace transitions", () => {
  it("shows current workspace/role but no switcher for a single membership or tenant host", async () => {
    await render(false);expect(container.textContent).toContain("Personal");expect(container.textContent).toContain("admin");expect(container.querySelector("select")).toBeNull();
    await render(true, true);expect(container.querySelector("select")).toBeNull();
  });
  it("unmounts tenant state before dispatch and keeps it hidden after an uncertain result", async () => {
    vi.mocked(switchWorkspace).mockImplementation(async () => { expect(closed).toHaveBeenCalledTimes(1);expect(container.textContent).not.toContain("Private tenant data");return { ok: false, message: "Reload to reconcile." }; });
    await render();await submit();expect(switchWorkspace).toHaveBeenCalledWith(B.id);expect(container.textContent).toContain("Reload to reconcile");expect(container.textContent).not.toContain("Private tenant data");
  });
  it("stops tenant state when another tab begins switching", async () => {
    await render();await act(async () => window.dispatchEvent(new StorageEvent("storage", { key: "albus-workspace-transition", newValue: JSON.stringify({ phase: "begin", nonce: "another-tab" }) })));
    expect(closed).toHaveBeenCalledTimes(1);expect(container.textContent).not.toContain("Private tenant data");expect(container.textContent).toContain("another tab");
  });
  it("reconciles a missed tab signal on focus", async () => {
    await render();localStorage.setItem("albus-workspace-transition", JSON.stringify({ phase: "begin", nonce: "missed" }));
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(container.textContent).not.toContain("Private tenant data");
  });
});
