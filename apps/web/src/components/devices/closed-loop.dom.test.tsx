// @vitest-environment happy-dom
import type { ActionProposal, DeviceAction } from "@albusforge/schema";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { confirmAction, proposeAction, setActionEnabled } from "@/actions/device-actions";
import { ClosedLoopActions, PENDING_LABEL, UNCONFIRMED_LABEL } from "./ClosedLoopActions";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh }) }));
vi.mock("@/actions/device-actions", () => ({ setActionEnabled: vi.fn(), proposeAction: vi.fn(), confirmAction: vi.fn() }));

const write = vi.mocked(setActionEnabled);
const propose = vi.mocked(proposeAction);
const confirm = vi.mocked(confirmAction);

const RULE: DeviceAction = { id: "a1", kind: "SERVO", rule: "Soil < 22% → water 5 min", via: "servo", enabled: true, sync: "pending", version: 1 };

/** A promise the test resolves by hand, to hold a write in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

let container: HTMLDivElement;
let root: Root;

const render = (actions: DeviceAction[], canEdit = true) =>
  act(async () => root.render(<ClosedLoopActions deviceId="bed-a" actions={actions} lastAction={null} canEdit={canEdit} />));
const switchFor = (id: string) => container.querySelector<HTMLButtonElement>(`li[data-status], li`)!.closest("ul")!.querySelector<HTMLButtonElement>(`li:nth-child(${id}) button[role="switch"]`)!;
const firstSwitch = () => container.querySelector<HTMLButtonElement>('button[role="switch"]')!;
const text = () => container.textContent ?? "";
const click = (el: HTMLElement) => act(async () => el.click());

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  refresh.mockReset();
  write.mockReset();
  propose.mockReset();
  confirm.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("ClosedLoopActions: the snapshot is the truth", () => {
  it("a refreshed snapshot that says synced clears the pending badge", async () => {
    await render([RULE]);
    expect(text()).toContain(PENDING_LABEL);
    await render([{ ...RULE, sync: "synced" }]);
    expect(text()).not.toContain(PENDING_LABEL);
  });

  it("a refreshed snapshot with a changed switch and a new rule from elsewhere is shown", async () => {
    await render([RULE]);
    expect(firstSwitch().getAttribute("aria-checked")).toBe("true");
    await render([{ ...RULE, enabled: false, version: 2 }, { ...RULE, id: "a2", rule: "Battery < 10% → text me", kind: "ALERT" }]);
    expect(firstSwitch().getAttribute("aria-checked")).toBe("false");
    expect(text()).toContain("Battery < 10% → text me");
  });

  it("a refresh while a write is in flight keeps the optimistic switch; the response then wins", async () => {
    const pending = deferred<Awaited<ReturnType<typeof setActionEnabled>>>();
    write.mockReturnValue(pending.promise);
    await render([RULE]);
    await click(firstSwitch());
    expect(firstSwitch().getAttribute("aria-checked")).toBe("false");
    expect(firstSwitch().disabled).toBe(true);

    await render([{ ...RULE }]); // a stale refresh: still enabled on the server
    expect(firstSwitch().getAttribute("aria-checked")).toBe("false");

    await act(async () => pending.resolve({ ok: true, data: { ...RULE, enabled: false, sync: "pending", version: 2 } }));
    expect(firstSwitch().getAttribute("aria-checked")).toBe("false");
    expect(firstSwitch().disabled).toBe(false);
    expect(write).toHaveBeenCalledWith("bed-a", "a1", false);

    // An older snapshot (version 1) doesn't undo it; the caught-up one is simply the same state.
    await render([{ ...RULE }]);
    expect(firstSwitch().getAttribute("aria-checked")).toBe("false");
    await render([{ ...RULE, enabled: false, version: 2 }]);
    expect(firstSwitch().getAttribute("aria-checked")).toBe("false");
    expect(switchFor).toBeTypeOf("function");
  });

  it("a refused write rolls the switch back and says why", async () => {
    write.mockResolvedValue({ ok: false, message: "Your role can’t change rules.", outcome: "refused" });
    await render([RULE]);
    await click(firstSwitch());
    expect(firstSwitch().getAttribute("aria-checked")).toBe("true");
    expect(firstSwitch().disabled).toBe(false);
    expect(container.querySelector('[role="alert"]')!.textContent).toBe("Your role can’t change rules.");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("an unknown outcome shows the server's copy as unconfirmed, locks the switch, refreshes, and the snapshot answers", async () => {
    write.mockResolvedValue({ ok: false, message: "We couldn’t confirm.", outcome: "unknown" });
    await render([RULE]);
    await click(firstSwitch());
    expect(firstSwitch().getAttribute("aria-checked")).toBe("true");
    expect(firstSwitch().disabled).toBe(true);
    expect(text()).toContain(UNCONFIRMED_LABEL);
    expect(refresh).toHaveBeenCalledTimes(1);

    // The refreshed snapshot says the write did go through.
    await render([{ ...RULE, enabled: false, version: 2 }]);
    expect(firstSwitch().getAttribute("aria-checked")).toBe("false");
    expect(firstSwitch().disabled).toBe(false);
    expect(text()).not.toContain(UNCONFIRMED_LABEL);
  });
});

describe("ClosedLoopActions: composer", () => {
  const proposal: ActionProposal = {
    id: "p1",
    kind: "ALERT",
    rule: "Battery < 10% → text me",
    via: "notification",
    summary: "When battery is below 10 %, text me.",
    issues: [],
    expires_at: "2026-09-13T12:10:00Z",
  };
  const created: DeviceAction = { id: "a9", kind: "ALERT", rule: proposal.rule, via: proposal.via, enabled: true, sync: "pending", version: 1 };

  const open = async () => {
    await click([...container.querySelectorAll("button")].find((b) => b.textContent === "+ New action")!);
  };
  const type = (value: string) =>
    act(async () => {
      const input = container.querySelector<HTMLInputElement>('input[name="rule"]')!;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  const submit = () => act(async () => container.querySelector("form")!.requestSubmit());
  const confirmButton = () => [...container.querySelectorAll("button")].find((b) => /Confirm/.test(b.textContent ?? ""))!;

  it("plain words become a proposal, confirming adds the rule, and a later snapshot carrying it takes over", async () => {
    propose.mockResolvedValue({ ok: true, data: proposal });
    confirm.mockResolvedValue({ ok: true, data: created });
    await render([]);
    await open();
    await type("text me when battery < 10%");
    await submit();
    expect(propose).toHaveBeenCalledWith("bed-a", "text me when battery < 10%");
    expect(container.querySelector('[data-testid="proposal"]')!.textContent).toContain("When battery is below 10 %");

    await click(confirmButton());
    expect(confirm).toHaveBeenCalledWith("bed-a", "p1");
    expect(container.querySelector('[data-testid="proposal"]')).toBeNull();
    expect(text()).toContain("Battery < 10% → text me");
    expect(text()).toContain(PENDING_LABEL);

    await render([{ ...created, sync: "synced" }]);
    expect(container.querySelectorAll('button[role="switch"]')).toHaveLength(1);
    expect(text()).not.toContain(PENDING_LABEL);
  });

  it("an unknown confirmation keeps the proposal so the retry uses the same id; a refused one drops it", async () => {
    propose.mockResolvedValue({ ok: true, data: proposal });
    confirm.mockResolvedValueOnce({ ok: false, message: "We couldn’t confirm whether the rule was saved.", outcome: "unknown" });
    confirm.mockResolvedValueOnce({ ok: true, data: created });
    await render([]);
    await open();
    await type("text me when battery < 10%");
    await submit();

    await click(confirmButton());
    expect(container.querySelector('[role="alert"]')!.textContent).toContain("couldn’t confirm");
    expect(container.querySelector('[data-testid="proposal"]')).not.toBeNull();

    await click(confirmButton());
    expect(confirm).toHaveBeenLastCalledWith("bed-a", "p1");
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(propose).toHaveBeenCalledTimes(1);
    expect(text()).toContain("Battery < 10% → text me");
  });

  it("a proposal with issues can't be confirmed; a refused confirmation drops the proposal and keeps the words", async () => {
    propose.mockResolvedValueOnce({ ok: true, data: { ...proposal, issues: ["I couldn't find a threshold."] } });
    await render([]);
    await open();
    await type("text me when battery is low");
    await submit();
    expect(confirmButton().disabled).toBe(true);

    propose.mockResolvedValueOnce({ ok: true, data: proposal });
    confirm.mockResolvedValueOnce({ ok: false, message: "That proposal expired. Propose the rule again.", outcome: "refused" });
    await type("text me when battery < 10%");
    await submit();
    await click(confirmButton());
    expect(container.querySelector('[data-testid="proposal"]')).toBeNull();
    expect(container.querySelector<HTMLInputElement>('input[name="rule"]')!.value).toBe("text me when battery < 10%");
    expect(container.querySelector('[role="alert"]')!.textContent).toContain("expired");
  });
});
