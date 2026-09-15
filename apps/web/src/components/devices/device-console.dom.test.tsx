// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import { DeviceConsole } from "./DeviceConsole";
import { chatWithDevice } from "@/actions/devices";

vi.mock("@/actions/devices", () => ({ chatWithDevice: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const answer = (over: Partial<Parameters<typeof reply>[0]> = {}) => reply(over);
function reply(over: Record<string, unknown>) {
  return {
    ok: true as const,
    data: {
      request_id: "22222222-2222-4222-8222-222222222222",
      device_id: "11111111-1111-4111-8111-111111111111",
      reply: "It peaked at 26.4 C today.",
      mode: "model" as const,
      queries: [{ tool: "query_window" as const, channel: "temperature_c", from: "2026-09-14T00:00:00.000Z", to: "2026-09-14T12:00:00.000Z", points: 12 }],
      limitations: [],
      ...over,
    },
  };
}

async function mount(props: Partial<Parameters<typeof DeviceConsole>[0]> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<DeviceConsole deviceId="dev-1" deviceName="Plant A" channelCount={2} {...props} />));
  const ask = async (question: string) => {
    const input = container.querySelector<HTMLInputElement>('input[name="question"]')!;
    await act(async () => {
      input.value = question;
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
  };
  return { container, root, ask, cleanup: async () => { await act(async () => root.unmount()); container.remove(); } };
}

beforeEach(() => vi.mocked(chatWithDevice).mockReset());

it("sends the question with no history on the first turn, and shows the reply", async () => {
  vi.mocked(chatWithDevice).mockResolvedValue(answer());
  const { container, ask, cleanup } = await mount();
  try {
    await ask("How warm?");
    expect(chatWithDevice).toHaveBeenCalledWith("dev-1", "How warm?", []);
    expect(container.textContent).toContain("It peaked at 26.4 C today.");
  } finally { await cleanup(); }
});

it("replays prior turns but never the greeting, and never the pending question twice", async () => {
  vi.mocked(chatWithDevice).mockResolvedValue(answer());
  const { ask, cleanup } = await mount();
  try {
    await ask("first");
    await ask("second");
    const history = vi.mocked(chatWithDevice).mock.calls[1]![2] as { role: string; text: string }[];
    expect(history).toEqual([
      { role: "user", text: "first" },
      { role: "assistant", text: "It peaked at 26.4 C today." },
    ]);
    // The greeting is ours, not a model turn, and "second" is the question.
    expect(history.some((turn) => turn.text.startsWith("Ask me about"))).toBe(false);
    expect(history.some((turn) => turn.text === "second")).toBe(false);
  } finally { await cleanup(); }
});

it("shows which windows the answer was written from", async () => {
  vi.mocked(chatWithDevice).mockResolvedValue(answer());
  const { container, ask, cleanup } = await mount();
  try {
    await ask("How warm?");
    expect(container.textContent).toContain("Read 1 query");
    expect(container.textContent).toContain("temperature_c");
    expect(container.textContent).toContain("12 pts");
  } finally { await cleanup(); }
});

it("marks an answer that read nothing", async () => {
  vi.mocked(chatWithDevice).mockResolvedValue(answer({ mode: "no_tool", queries: [] }));
  const { container, ask, cleanup } = await mount();
  try {
    await ask("hello");
    expect(container.textContent).toContain("Answered without reading any stored readings");
  } finally { await cleanup(); }
});

it("marks a deterministic fallback as not a written answer", async () => {
  vi.mocked(chatWithDevice).mockResolvedValue(answer({ mode: "unavailable", queries: [] }));
  const { container, ask, cleanup } = await mount();
  try {
    await ask("hello");
    expect(container.textContent).toContain("assistant was unavailable");
  } finally { await cleanup(); }
});

it("returns an unanswered question to the input and leaves history truthful", async () => {
  vi.mocked(chatWithDevice).mockResolvedValue({ ok: false, message: "Sensor chat is busy." });
  const { container, ask, cleanup } = await mount();
  try {
    await ask("How warm?");
    expect(container.querySelector<HTMLInputElement>('input[name="question"]')!.value).toBe("How warm?");
    expect(container.querySelector('[role="alert"]')!.textContent).toContain("busy");
    // The failed turn must not appear in the next request's history.
    vi.mocked(chatWithDevice).mockResolvedValue(answer());
    await ask("How warm?");
    expect(vi.mocked(chatWithDevice).mock.calls[1]![2]).toEqual([]);
  } finally { await cleanup(); }
});

it("offers a device with no channels a reason to ask anyway", async () => {
  const { container, cleanup } = await mount({ channelCount: 0 });
  try {
    expect(container.textContent).toContain("has not stored any readings yet");
    expect(container.querySelector('input[name="question"]')).not.toBeNull();
  } finally { await cleanup(); }
});

it("says a spent daily allowance is not a retry, and keeps the plots unblamed", async () => {
  vi.mocked(chatWithDevice).mockResolvedValue({
    ok: false,
    message: "You’ve reached today’s limit for device questions. The plots below are unaffected.",
  });
  const { container, ask, cleanup } = await mount();
  try {
    await ask("How warm?");
    const alert = container.querySelector('[role="alert"]')!.textContent!;
    expect(alert).toContain("today’s limit");
    expect(alert).not.toContain("Try again in a moment");
  } finally { await cleanup(); }
});
