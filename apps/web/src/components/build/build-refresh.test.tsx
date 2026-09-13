// @vitest-environment happy-dom
import { BUILD_EVENT } from "@albusforge/schema";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BuildTranscript } from "@/lib/build-transcript";
import type { EventStreamOptions } from "@/lib/sse/useEventStream";
import { BuildConversation, useConversation } from "./BuildConversation";
import { ConversationView } from "./ConversationView";

const mocks = vi.hoisted(() => ({ refreshBuild: vi.fn(), startBuild: vi.fn(), sendBuildMessage: vi.fn() }));
vi.mock("@/actions/builds", () => mocks);
let stream: EventStreamOptions;
vi.mock("@/lib/sse/useEventStream", () => ({ useEventStream: (_path: string, options: EventStreamOptions) => { stream = options; } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
let current: ReturnType<typeof useConversation>;
function Inspect() {
  const conversation = useConversation();
  useEffect(() => { current = conversation; });
  return <ConversationView active />;
}

const initial: BuildTranscript = {
  buildId: "bld_refresh", status: "specifying", specVersion: 1, spec: { sense: { what: ["soil moisture"] } },
  messages: [{ id: "m1", role: "user", text: "go", created_at: "2026-09-13T12:00:00Z" }],
  candidateParts: [], ready: null,
};
const updated: BuildTranscript = {
  ...initial, status: "planning", specVersion: 2, spec: { sense: { what: ["soil moisture", "temperature"] }, settled: true },
  messages: [...initial.messages, { id: "m2", role: "assistant", text: "The design is ready", created_at: "2026-09-13T12:00:01Z" }],
  ready: { name: "Greenhouse", est_price_usd: 34, fulfillment_note: "ships in kit form", parts: [] },
};

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<BuildConversation initial={initial}><Inspect /></BuildConversation>));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
async function finalEvents() {
  await act(async () => {
    stream.onEvent(BUILD_EVENT.buildUpdated, { status: "planning", spec_version: 2 });
    stream.onEvent(BUILD_EVENT.messageCreated, { message: updated.messages[1] });
  });
}

it("offers detail recovery after the assistant reply and bounded retries, without another stream event or send", async () => {
  mocks.refreshBuild.mockResolvedValue({ ok: false, message: "Details could not be loaded" });
  await finalEvents();
  expect(current.typing).toBe(false);
  expect(current.state.specVersion).toBe(1);
  expect(current.state.observedSpecVersion).toBe(2);
  await advance(1_000);
  await advance(2_000);
  expect(mocks.refreshBuild).toHaveBeenCalledTimes(3);
  await advance(60_000);
  expect(mocks.refreshBuild).toHaveBeenCalledTimes(3);
  expect(container.textContent).toContain("Details could not be loaded");
  const retry = [...container.querySelectorAll("button")].find((button) => button.textContent === "Refresh build details");
  expect(retry).toBeDefined();

  mocks.refreshBuild.mockResolvedValue({ ok: true, data: updated });
  await act(async () => retry!.click());
  expect(current.state).toMatchObject({ specVersion: 2, detailsStale: false, refreshError: null, ready: updated.ready });
  expect(container.textContent).toContain("temperature");
  expect(container.querySelector('[aria-label="Device design ready"]')).not.toBeNull();
  expect(container.textContent).not.toContain("Refresh build details");
  expect(mocks.startBuild).not.toHaveBeenCalled();
  expect(mocks.sendBuildMessage).not.toHaveBeenCalled();
});

it("retries a stale successful snapshot until the observed version is hydrated", async () => {
  mocks.refreshBuild.mockResolvedValueOnce({ ok: true, data: initial }).mockResolvedValue({ ok: true, data: updated });
  await finalEvents();
  expect(current.state).toMatchObject({ specVersion: 1, observedSpecVersion: 2, detailsStale: true });
  await advance(1_000);
  expect(current.state).toMatchObject({ specVersion: 2, detailsStale: false, refreshError: null });
  await advance(60_000);
  expect(mocks.refreshBuild).toHaveBeenCalledTimes(2);
});

it("cancels old retries when the stream reopens and cancels remaining retries on unmount", async () => {
  mocks.refreshBuild.mockResolvedValue({ ok: false, message: "offline" });
  await finalEvents();
  await advance(500);
  await act(async () => { stream.onOpen?.(); });
  expect(mocks.refreshBuild).toHaveBeenCalledTimes(2);
  await advance(500); // The superseded request's retry would fire here.
  expect(mocks.refreshBuild).toHaveBeenCalledTimes(2);
  await act(async () => root.render(null));
  await advance(60_000);
  expect(mocks.refreshBuild).toHaveBeenCalledTimes(2);
});
