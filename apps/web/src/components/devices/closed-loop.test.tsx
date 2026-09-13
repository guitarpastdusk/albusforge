import type { ActionProposal, DeviceAction } from "@albusforge/schema";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CONNECTION_MESSAGE } from "@/lib/safe-action";
import { upsertAction, withEnabled, writeOnce } from "./closed-loop-flow";
import { ClosedLoopActions, PENDING_LABEL, ProposalCard, READ_ONLY_NOTE } from "./ClosedLoopActions";

// The card's Server Functions are "use server" modules; the render tests never call them.
vi.mock("@/actions/device-actions", () => ({ setActionEnabled: vi.fn(), proposeAction: vi.fn(), confirmAction: vi.fn() }));

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
  it("writeOnce never rejects: a network failure becomes the connection message", async () => {
    await expect(writeOnce(vi.fn().mockRejectedValue(new TypeError("Failed to fetch")))).resolves.toEqual({ ok: false, message: CONNECTION_MESSAGE });
  });

  it("writeOnce passes a refusal's message through and a success's data", async () => {
    await expect(writeOnce(async () => ({ ok: false, message: "Your role can’t change rules." }))).resolves.toEqual({ ok: false, message: "Your role can’t change rules." });
    await expect(writeOnce(async () => ({ ok: true, data: ACTIONS[0]! }))).resolves.toEqual({ ok: true, data: ACTIONS[0] });
  });

  it("withEnabled flips one switch and upsertAction replaces by id or appends", () => {
    expect(withEnabled(ACTIONS, "a2", true).map((a) => a.enabled)).toEqual([true, true]);
    const synced = { ...ACTIONS[1]!, sync: "synced" as const };
    expect(upsertAction(ACTIONS, synced)[1]).toEqual(synced);
    const fresh: DeviceAction = { id: "a3", kind: "API", rule: "x → y", via: "z", enabled: true, sync: "pending" };
    expect(upsertAction(ACTIONS, fresh)).toHaveLength(3);
  });
});
