"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { useConversation } from "./BuildConversation";
import { ChatBubble, TypingDots } from "./ChatBubble";
import { DesignReadyCard } from "./DesignReadyCard";

/**
 * The active chat: bubbles, typing dots, the device-ready card and the sticky
 * reply bar. On the landing page it appears once the first message is sent;
 * `active` shows it regardless (the /build/[buildId] page).
 */
export function ConversationView({ active = false }: { active?: boolean }) {
  const { state, send } = useConversation();
  const [text, setText] = useState("");

  if (!active && state.messages.length === 0) return null;

  return (
    <div className="mx-auto box-border flex w-full max-w-[860px] flex-1 flex-col px-6 pt-9 pb-7">
      <div className="flex flex-1 flex-col gap-[18px]" aria-live="polite">
        {state.messages.map((message) => (
          <ChatBubble key={message.id} role={message.role} text={message.text} />
        ))}
        {state.typing ? <TypingDots /> : null}
        {state.error ? (
          <p role="alert" className="text-[15px] text-coral-deep">
            {state.error}
          </p>
        ) : null}
        {state.ready ? <DesignReadyCard card={state.ready} /> : null}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          // Read the field, not `text`: an Enter right after typing can fire before React re-renders.
          const value = String(new FormData(event.currentTarget).get("reply") ?? "");
          if (send(value)) setText("");
        }}
        className="sticky bottom-5 mt-[26px] flex items-center gap-3.5 rounded-[20px] border border-hairline bg-white py-2 pr-2 pl-[22px] shadow-card"
      >
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          name="reply"
          aria-label="Reply"
          placeholder="Reply…"
          className="min-w-0 flex-1 bg-transparent py-3 text-[17px] text-ink outline-none"
        />
        <Button type="submit" variant="dark" className="rounded-[14px] px-[22px] py-3 text-[16px] font-medium">
          Send
        </Button>
      </form>
    </div>
  );
}
