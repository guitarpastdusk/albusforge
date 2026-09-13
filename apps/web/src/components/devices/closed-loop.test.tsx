import type { ActionProposal, DeviceAction } from "@albusforge/schema";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CONNECTION_MESSAGE } from "@/lib/safe-action";
import { mergeRules, NO_LOCAL_RULES, reconcile, withAdded, withOverride, writeOnce, type LocalRules } from "./closed-loop-flow";
import { ClosedLoopActions, PENDING_LABEL, ProposalCard, READ_ONLY_NOTE } from "./ClosedLoopActions";

// The card's Server Functions are "use server" modules; the render tests never call them.
vi.mock("@/actions/device-actions", () => ({ setActionEnabled: vi.fn(), proposeAction: vi.fn(), confirmAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));

const ACTIONS: DeviceAction[] = [
  { id: "a1", kind: "SERVO", rule: "Soil < 22% → open irrigation valve, 5 min", via: "micro-servo on GPIO 14", enabled: true },
  { id: "a2", kind: "ALERT", rule: "Still dry after 2 cycles → text me", via: "guardrail — human takes over", enabled: false, sync: "pending" },
];

describe("ClosedLoopActions", () => {
  it("read-only: badge, disabled switches described by the note, and no composer button enabled", () => {
    const html = renderToStaticMarkup(<ClosedLoopActions deviceId="bed-a" actions={ACTIONS} lastAction="valve opened, yesterday 06:12" canEdit={false} />);
    expect(html).toContain("Read-only");
    expect(html).toContain(READ_ONLY_NOTE);
    expect(html).toContain("last action: valve opened, yesterday 06:12");
    expect(html.match(/role="switch"[^>]*disabled=""/g)).toHaveLength(2);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>\+ New action</);
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('aria-checked="false"');
  });

  it("editable: switches live, the pending rule labelled, and a plain-words prompt", () => {
    const html = renderToStaticMarkup(<ClosedLoopActions deviceId="bed-a" actions={ACTIONS} lastAction={null} canEdit />);
    expect(html).not.toContain("Read-only");
    expect(html).not.toMatch(/role="switch"[^>]*disabled=""/);
    expect(html).toContain(PENDING_LABEL);
    expect(html.match(new RegExp(PENDING_LABEL, "g"))).toHaveLength(1);
    expect(html).toContain("Add a rule in plain words");
    expect(html).toMatch(/bg-pastel-green[^>]*>SERVO/);
    expect(html).toMatch(/bg-pastel-peach[^>]*>ALERT/);
    expect(html.match(/aria-checked="(true|false)"/g)).toEqual(['aria-checked="true"', 'aria-checked="false"']);
  });

  it("a device with no rules yet says so, and offers the first one to an editor", () => {
    const html = renderToStaticMarkup(<ClosedLoopActions deviceId="bed-c" actions={[]} lastAction={null} canEdit />);
    expect(html).toContain("No rules yet.");
    expect(html).toContain("nothing acts on its readings until you add one");
    expect(html).not.toContain('role="switch"');
  });
});

describe("ProposalCard", () => {
  const proposal: ActionProposal = {
    id: "p1",
    kind: "SERVO",
    rule: "Soil moisture < 22% → water for 5 min",
    via: "micro-servo on GPIO 14",
    summary: "When soil moisture is below 22 % VWC, water for 5 min.",
    issues: [],
    expires_at: "2026-09-13T12:10:00Z",
  };

  it("a clean proposal can be confirmed and shows how it will run", () => {
    const html = renderToStaticMarkup(<ProposalCard proposal={proposal} pending={false} onConfirm={() => {}} />);
    expect(html).toContain("Soil moisture &lt; 22% → water for 5 min");
    expect(html).toContain("When soil moisture is below 22 % VWC");
    expect(html).toContain("micro-servo on GPIO 14");
    expect(html).toMatch(/<button[^>]*>Confirm rule</);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Confirm rule</);
  });

  it("a proposal with issues lists them and can't be confirmed", () => {
    const html = renderToStaticMarkup(
      <ProposalCard proposal={{ ...proposal, issues: ["I couldn't find a threshold."], summary: "I need a bit more." }} pending={false} onConfirm={() => {}} />,
    );
    expect(html).toContain("I couldn&#x27;t find a threshold.");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Confirm rule</);
    expect(html).toContain("Edit the words above and propose again.");
    expect(html).not.toContain("micro-servo");
  });
});

describe("closed-loop flow helpers", () => {
  it("writeOnce never rejects: a network failure is an unknown outcome, never a refusal", async () => {
    await expect(writeOnce(vi.fn().mockRejectedValue(new TypeError("Failed to fetch")))).resolves.toEqual({
      ok: false,
      message: CONNECTION_MESSAGE,
      outcome: "unknown",
    });
  });

  it("writeOnce passes a refusal and a success through", async () => {
    await expect(writeOnce(async () => ({ ok: false, message: "No.", outcome: "refused" }))).resolves.toEqual({ ok: false, message: "No.", outcome: "refused" });
    await expect(writeOnce(async () => ({ ok: true, data: ACTIONS[0]! }))).resolves.toEqual({ ok: true, data: ACTIONS[0] });
  });

  it("mergeRules layers writing and written overrides, shows the server copy for unknown, and appends additions", () => {
    const flipped = { ...ACTIONS[0]!, enabled: false };
    const added: DeviceAction = { id: "a3", kind: "API", rule: "x → y", via: "z", enabled: true, sync: "pending" };
    const rows = mergeRules(ACTIONS, {
      overrides: { a1: { action: flipped, state: "writing" }, a2: { action: { ...ACTIONS[1]!, enabled: true }, state: "unknown" } },
      added: [added],
    });
    expect(rows.map((r) => [r.action.id, r.action.enabled, r.status])).toEqual([
      ["a1", false, "writing"],
      ["a2", false, "unknown"],
      ["a3", true, null],
    ]);
  });

  it("reconcile keeps in-flight writes, retires unknown and completed ones, and drops additions the snapshot carries", () => {
    const local: LocalRules = {
      overrides: {
        a1: { action: { ...ACTIONS[0]!, enabled: false }, state: "writing" },
        a2: { action: ACTIONS[1]!, state: "unknown" },
      },
      added: [{ id: "a3", kind: "API", rule: "x → y", via: "z", enabled: true }],
    };
    const next = reconcile([...ACTIONS, { id: "a3", kind: "API", rule: "x → y", via: "z", enabled: true, sync: "synced" }], local);
    expect(Object.keys(next.overrides)).toEqual(["a1"]);
    expect(next.added).toEqual([]);
  });

  it("reconcile keeps a completed write when the snapshot is older by version, and retires it once the snapshot catches up", () => {
    const written = { ...ACTIONS[0]!, enabled: false, sync: "pending" as const, version: 3 };
    const local: LocalRules = { overrides: { a1: { action: written, state: "written" } }, added: [] };
    expect(reconcile([{ ...ACTIONS[0]!, version: 2 }], local).overrides.a1).toEqual(local.overrides.a1);
    expect(reconcile([{ ...ACTIONS[0]!, version: 3 }], local).overrides.a1).toBeUndefined();
    // Without versions, the next snapshot wins.
    expect(reconcile([ACTIONS[0]!], { overrides: { a1: { action: { ...written, version: undefined }, state: "written" } }, added: [] }).overrides.a1).toBeUndefined();
  });

  it("withOverride sets and clears; withAdded replaces by id", () => {
    const set = withOverride(NO_LOCAL_RULES, "a1", { action: ACTIONS[0]!, state: "written" });
    expect(Object.keys(set.overrides)).toEqual(["a1"]);
    expect(withOverride(set, "a1", null)).toEqual(NO_LOCAL_RULES);
    const added: DeviceAction = { id: "a3", kind: "API", rule: "x → y", via: "z", enabled: true };
    expect(withAdded(withAdded(NO_LOCAL_RULES, added), { ...added, enabled: false }).added).toEqual([{ ...added, enabled: false }]);
  });
});
