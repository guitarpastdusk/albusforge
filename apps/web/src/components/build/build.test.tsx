import type { ChatMessage, DeviceReadyCard } from "@albusforge/schema";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatBubble, TypingDots } from "./ChatBubble";
import { conversationReducer, initConversation } from "./conversation";
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
  it("adds the sent message optimistically and starts typing", () => {
    const state = conversationReducer(initConversation(), { type: "sent", text: "A soil sensor", at: AT });
    expect(state.typing).toBe(true);
    expect(state.messages).toEqual([{ id: "local-1", role: "user", text: "A soil sensor", created_at: AT }]);
  });

  it("replaces the optimistic copy with the server transcript, and picks up the build and ready card", () => {
    const sent = conversationReducer(initConversation(), { type: "sent", text: "go", at: AT });
    const transcript = [reply("msg_1", "user", "go"), reply("msg_2", "assistant", "Done")];
    const state = conversationReducer(sent, {
      type: "replied",
      transcript: { buildId: "bld_1", messages: transcript, ready: READY },
    });
    expect(state).toMatchObject({ buildId: "bld_1", typing: false, ready: READY, error: null });
    expect(state.messages).toEqual(transcript);
  });

  it("keeps the user's message and shows the error when sending fails", () => {
    const sent = conversationReducer(initConversation({ buildId: "bld_1" }), { type: "sent", text: "hi", at: AT });
    const state = conversationReducer(sent, { type: "failed", message: "We can’t reach the service right now." });
    expect(state).toMatchObject({ typing: false, error: "We can’t reach the service right now.", buildId: "bld_1" });
    expect(state.messages).toHaveLength(1);
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
