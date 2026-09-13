import type { ChatMessage, DeviceReadyCard } from "@albusforge/schema";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CONNECTION_MESSAGE } from "@/lib/safe-action";
import { ChatBubble, TypingDots } from "./ChatBubble";
import {
  conversationReducer,
  initConversation,
  runCheck,
  runSend,
  type ConversationActions,
  type ConversationEvent,
  type ConversationState,
} from "./conversation";
import { DesignReadyCard } from "./DesignReadyCard";

const AT = "2026-09-13T12:00:00Z";

const reply = (id: string, role: ChatMessage["role"], text: string): ChatMessage => ({ id, role, text, created_at: AT });

const READY: DeviceReadyCard = {
  name: "Greenhouse soil monitor",
  est_price_usd: 34,
  fulfillment_note: "ships in kit form",
  parts: [
    { part_id: "esp32-wroom", label: "ESP32-WROOM", accent: "peach" },
    { part_id: "solar-lipo", label: "Solar + LiPo", accent: "green" },
  ],
};

describe("conversationReducer", () => {
  it("adds the sent message optimistically, clears the draft and starts typing", () => {
    const drafted = conversationReducer(initConversation(), { type: "draft", text: "A soil sensor" });
    const state = conversationReducer(drafted, { type: "sent", text: "A soil sensor", at: AT });
    expect(state).toMatchObject({ typing: true, draft: "" });
    expect(state.messages).toEqual([{ id: "local-1", role: "user", text: "A soil sensor", created_at: AT }]);
  });

  it("replaces the optimistic copy with the server transcript, and picks up the build and ready card", () => {
    const sent = conversationReducer(initConversation(), { type: "sent", text: "go", at: AT });
    const transcript = [reply("msg_1", "user", "go"), reply("msg_2", "assistant", "Done")];
    const state = conversationReducer(sent, {
      type: "replied",
      transcript: { buildId: "bld_1", messages: transcript, ready: READY },
    });
    expect(state).toMatchObject({ buildId: "bld_1", typing: false, ready: READY, error: null, awaitingReply: false });
    expect(state.messages).toEqual(transcript);
  });
});

/** Drive the reducer the way the provider does. */
function harness(initial?: Parameters<typeof initConversation>[0]) {
  let state: ConversationState = initConversation(initial);
  const dispatch = (event: ConversationEvent) => {
    state = conversationReducer(state, event);
  };
  return { dispatch, get state() { return state; } };
}

const actions = (overrides: Partial<ConversationActions>): ConversationActions => ({
  startBuild: vi.fn(),
  sendBuildMessage: vi.fn(),
  checkForReply: vi.fn(),
  ...overrides,
});

describe("runSend", () => {
  it("a rejected call (network failure, aborted dispatch) clears typing, restores the draft and shows a retryable message", async () => {
    const h = harness();
    h.dispatch({ type: "sent", text: "A soil sensor", at: AT });

    const result = await runSend(null, "A soil sensor", actions({ startBuild: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) }), h.dispatch);

    expect(result).toBeNull();
    expect(h.state).toMatchObject({ typing: false, error: CONNECTION_MESSAGE, draft: "A soil sensor", messages: [] });
  });

  it("an { ok: false } result shows the server's message and also restores the draft", async () => {
    const h = harness({ buildId: "bld_1", messages: [reply("m1", "user", "hi"), reply("m2", "assistant", "hello")] });
    h.dispatch({ type: "sent", text: "one bed", at: AT });

    await runSend("bld_1", "one bed", actions({ sendBuildMessage: vi.fn().mockResolvedValue({ ok: false, message: "We can’t reach the service right now." }) }), h.dispatch);

    expect(h.state).toMatchObject({ typing: false, error: "We can’t reach the service right now.", draft: "one bed", awaitingReply: false });
    expect(h.state.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("keeps a newer draft typed while the send was pending", async () => {
    const h = harness();
    h.dispatch({ type: "sent", text: "first", at: AT });
    h.dispatch({ type: "draft", text: "second thought" });
    await runSend(null, "first", actions({ startBuild: vi.fn().mockRejectedValue(new Error("x")) }), h.dispatch);
    expect(h.state.draft).toBe("second thought");
  });

  it("a reply that hasn't arrived keeps the sent message and offers to check again, not to resend", async () => {
    const pending = { buildId: "bld_1", messages: [reply("m1", "user", "hi")], ready: null };
    const h = harness();
    h.dispatch({ type: "sent", text: "hi", at: AT });

    const result = await runSend(null, "hi", actions({ startBuild: vi.fn().mockResolvedValue({ ok: false, message: "Taking longer than usual.", awaitingReply: pending }) }), h.dispatch);

    expect(result).toEqual(pending);
    expect(h.state).toMatchObject({ typing: false, awaitingReply: true, draft: "", buildId: "bld_1", error: "Taking longer than usual." });
    expect(h.state.messages).toEqual(pending.messages);
  });

  it("passes the reply through on success", async () => {
    const transcript = { buildId: "bld_1", messages: [reply("m1", "user", "hi"), reply("m2", "assistant", "hello")], ready: null };
    const h = harness();
    h.dispatch({ type: "sent", text: "hi", at: AT });
    await expect(runSend(null, "hi", actions({ startBuild: vi.fn().mockResolvedValue({ ok: true, data: transcript }) }), h.dispatch)).resolves.toEqual(transcript);
    expect(h.state).toMatchObject({ typing: false, error: null, messages: transcript.messages });
  });
});

describe("runCheck", () => {
  const pending = { buildId: "bld_1", messages: [reply("m1", "user", "hi")], ready: null };

  it("a rejected check keeps the check-again state and shows the connection message", async () => {
    const h = harness();
    h.dispatch({ type: "stalled", message: "Taking longer than usual.", transcript: pending });
    await runCheck("bld_1", 0, actions({ checkForReply: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) }), h.dispatch);
    expect(h.state).toMatchObject({ typing: false, awaitingReply: true, error: CONNECTION_MESSAGE });
    expect(h.state.messages).toEqual(pending.messages);
  });

  it("a successful check shows the reply", async () => {
    const h = harness();
    h.dispatch({ type: "stalled", message: "Taking longer than usual.", transcript: pending });
    const replied = { ...pending, messages: [...pending.messages, reply("m2", "assistant", "hello")] };
    await runCheck("bld_1", 0, actions({ checkForReply: vi.fn().mockResolvedValue({ ok: true, data: replied }) }), h.dispatch);
    expect(h.state).toMatchObject({ awaitingReply: false, error: null, messages: replied.messages });
  });
});

describe("chat markup", () => {
  it("puts the user on the right in ink and the assistant on the left in white", () => {
    expect(renderToStaticMarkup(<ChatBubble role="user" text="hi" />)).toMatch(/justify-end.*bg-ink/);
    expect(renderToStaticMarkup(<ChatBubble role="assistant" text="hello" />)).toMatch(/justify-start.*bg-white/);
  });

  it("renders three blinking dots while replying", () => {
    expect(renderToStaticMarkup(<TypingDots />).match(/animate-af-blink/g)).toHaveLength(3);
  });

  it("renders the device-ready card with price, parts and the sign-up gate", () => {
    const html = renderToStaticMarkup(<DesignReadyCard card={READY} />);
    expect(html).toContain("✓ Device design ready");
    expect(html).toContain("est. $34 · ships in kit form");
    expect(html).toContain("ESP32-WROOM");
    expect(html).toMatch(/href="\/signup"[^>]*>Sign up to continue →/);
  });
});
