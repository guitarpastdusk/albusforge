import type { ChatMessage } from "@albusforge/schema";
import { cx } from "@/lib/cx";

export function ChatBubble({ role, text }: Pick<ChatMessage, "role" | "text">) {
  const mine = role === "user";
  return (
    <div className={cx("flex", mine ? "justify-end" : "justify-start")}>
      <div
        className={cx(
          "whitespace-pre-line px-[22px] py-4 text-[17px] font-light leading-[1.5]",
          // The design's 78% max-width excludes padding (and the border), so add them back.
          mine
            ? "max-w-[calc(78%+44px)] rounded-[18px_18px_6px_18px] bg-ink text-white"
            : "max-w-[calc(78%+46px)] rounded-[18px_18px_18px_6px] border border-hairline bg-white text-ink",
        )}
      >
        {text}
      </div>
    </div>
  );
}

export function TypingDots() {
  return (
    <div className="flex" role="status" aria-label="Replying">
      <div className="flex gap-1.5 rounded-[18px_18px_18px_6px] border border-hairline bg-white px-[22px] py-4">
        {["0s", "0.2s", "0.4s"].map((delay) => (
          <span
            key={delay}
            aria-hidden
            className="size-2 rounded-full bg-coral-deep animate-af-blink motion-reduce:animate-none"
            style={{ animationDelay: delay }}
          />
        ))}
      </div>
    </div>
  );
}
