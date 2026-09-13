"use client";

import { Button } from "@/components/ui";
import { useConversation } from "./BuildConversation";
import { CandidateParts } from "./CandidateParts";
import { ChatBubble, TypingDots } from "./ChatBubble";
import { SessionReadyCard } from "./SessionReadyCard";
import { SpecPanel } from "./SpecPanel";

/**
 * The active chat: bubbles, typing dots, what intake has worked out (spec and
 * candidate parts), the device-ready card and the sticky reply bar. On the landing page it appears once the first message is sent;
 * `active` shows it regardless (the /build/[buildId] page).
 */
export function ConversationView({ active = false }: { active?: boolean }) {
  const { state, signedIn, typing, send, setDraft, checkAgain, enclosurePreview } = useConversation();

  if (!active && state.messages.length === 0) return null;

  return (
    <div className="mx-auto box-border flex w-full max-w-[860px] flex-1 flex-col px-6 pt-9 pb-7">
      <div className="flex flex-1 flex-col gap-[18px]" aria-live="polite">
        {state.messages.map((message) => (
          <ChatBubble key={message.id} role={message.role} text={message.text} />
        ))}
        {typing ? <TypingDots /> : null}
        {state.error ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-[15px] text-coral-deep">
            <span>{state.error}</span>
            {state.overdue ? (
              <button type="button" onClick={checkAgain} className="font-semibold hover:text-coral">
                Check for a reply
              </button>
            ) : null}
          </div>
        ) : null}
        {state.refreshError ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-[15px] text-coral-deep">
            <span>{state.refreshError}</span>
            <button type="button" onClick={checkAgain} className="font-semibold hover:text-coral">
              Refresh build details
            </button>
          </div>
        ) : state.detailsStale ? (
          <p role="status" className="text-[14px] text-muted">Updating build details…</p>
        ) : null}
        <SpecPanel spec={state.spec} status={state.status} />
        <CandidateParts parts={state.candidateParts} />
        {state.ready && state.buildId ? <SessionReadyCard buildId={state.buildId} signedIn={signedIn} card={state.ready} enclosure={enclosurePreview} /> : null}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          // Read the field, not state: an Enter right after typing can fire before React re-renders.
          send(String(new FormData(event.currentTarget).get("reply") ?? ""));
        }}
        className="sticky bottom-5 mt-[26px] flex items-center gap-3.5 rounded-[20px] border border-hairline bg-white py-2 pr-2 pl-[22px] shadow-card"
      >
        <input
          value={state.draft}
          onChange={(event) => setDraft(event.target.value)}
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
