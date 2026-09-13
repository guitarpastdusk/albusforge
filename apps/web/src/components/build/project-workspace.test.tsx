// @vitest-environment happy-dom
import type { BuildDetail } from "@albusforge/schema";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BuildConversation } from "./BuildConversation";
import { ConversationView } from "./ConversationView";
import { ProjectOverview } from "./ProjectOverview";
import { SpecPanel } from "./SpecPanel";

vi.mock("@/actions/builds", () => ({ refreshBuild: vi.fn(), startBuild: vi.fn(), sendBuildMessage: vi.fn() }));
vi.mock("@/lib/sse/useEventStream", () => ({ useEventStream: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const build: BuildDetail = {
  id: "build/a", name: "Garden monitor", description: "Watch the plants", display_status: "designing",
  device_count: 0, updated_at: "2026-09-13T12:00:00Z", ready: null, status: "asking", spec: null,
};

describe("project workspace", () => {
  it("resumes the exact build with an honest empty spec and unavailable artifacts", () => {
    const html = renderToStaticMarkup(<ProjectOverview build={build} />);
    expect(html).toContain('href="/build/build%2Fa"');
    expect(html).toContain("Resume conversation");
    expect(html).toContain("No specification has been saved yet");
    expect(html).toContain("not available in this workspace yet");
    expect(html).not.toContain(".glb");
    expect(html).not.toContain("order the kit");
  });

  it("distinguishes a settled specification from a ready design and renders saved versions", () => {
    const html = renderToStaticMarkup(<ProjectOverview build={{ ...build, status: "planning", spec_version: 3, spec: { settled: true, capabilities: ["read.temperature_c"] } }} />);
    expect(html).toContain("Version 3");
    expect(html).toContain("Spec settled");
    expect(html).toContain("read.temperature_c");
    expect(html).toContain("do not yet confirm a feasible design");
    expect(html).not.toContain('id="design-summary"');
  });

  it("renders only supplied ready parts and points live builds to the real fleet", () => {
    const html = renderToStaticMarkup(<ProjectOverview build={{ ...build, display_status: "live", status: "ordered", ready: { name: "Garden", est_price_usd: 42.5, fulfillment_note: "Estimate", parts: [{ part_id: "P-001", label: "Provided part", accent: "blue" }] } }} />);
    expect(html).toContain("Design summary");
    expect(html).toContain("Provided part");
    expect(html).toContain("42.50");
    expect(html).toContain('href="/live"');
  });

  it("uses shared optional experience fields and rejects invalid capability identifiers", () => {
    const html = renderToStaticMarkup(<SpecPanel spec={{ capabilities: ["read.temperature_c"], experience: { dashboard: true } }} status="asking" />);
    expect(html).toContain("a dashboard");
    expect(html).toContain("read.temperature_c");
    expect(renderToStaticMarkup(<SpecPanel spec={{ capabilities: ["invented capability"] }} status={null} />)).toBe("");
  });

  it("keeps the chat and safe project signup link usable while session resolution stalls", async () => {
    let resolve!: (signedIn: boolean) => void;
    const session = new Promise<boolean>(done => { resolve = done; });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(
        <BuildConversation signedIn={session} initial={{ buildId: build.id, messages: [], status: "ready", specVersion: null, spec: null, candidateParts: [], ready: { name: "Garden", est_price_usd: 42.5, fulfillment_note: "Estimate", parts: [] } }}>
          <ConversationView active />
        </BuildConversation>,
      ));
      expect(container.querySelector('input[name="reply"]')).not.toBeNull();
      expect(container.querySelector('a[href^="/signup?"]')).not.toBeNull();
      await act(async () => { resolve(true); await session; });
      expect(container.querySelector('a[href="/projects/build%2Fa"]')).not.toBeNull();
      expect(container.querySelector('a[href^="/signup?"]')).toBeNull();
      expect(container.querySelector('input[name="reply"]')).not.toBeNull();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it.each([false, true])("keeps the ready-card destination through the live conversation (signed in: %s)", async signedIn => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(
        <BuildConversation signedIn={signedIn} initial={{ buildId: build.id, messages: [], status: "ready", specVersion: null, spec: null, candidateParts: [], ready: { name: "Garden", est_price_usd: 42.5, fulfillment_note: "Estimate", parts: [] } }}>
          <ConversationView active />
        </BuildConversation>,
      ));
      const link = container.querySelector<HTMLAnchorElement>(signedIn ? 'a[href^="/projects/"]' : 'a[href^="/signup?"]');
      expect(link).not.toBeNull();
      if (signedIn) {
        expect(link!.getAttribute("href")).toBe("/projects/build%2Fa");
        expect(link!.textContent).toContain("Open project");
        expect(container.textContent).not.toContain("Create an account");
      } else {
        expect(new URL(link!.href).searchParams.get("next")).toBe("/projects/build%2Fa");
        expect(link!.textContent).toContain("Sign up to continue");
      }
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
