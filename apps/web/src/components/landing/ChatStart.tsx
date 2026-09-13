"use client";

import { useConversation } from "@/components/build/BuildConversation";
import { Button } from "@/components/ui";

const STARTERS = [
  "A sensor that texts me when the fridge door is left open",
  "Monitor vibration on my workshop compressor",
  "Track light + humidity for my orchids",
];

/** The landing input and starter chips. Sending starts the conversation in place. */
export function ChatStart() {
  const { state, send, setDraft } = useConversation();

  return (
    <>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          // Read the field, not state: an Enter right after typing can fire before React re-renders.
          send(String(new FormData(event.currentTarget).get("ask") ?? ""));
        }}
        className="mt-9 flex w-full max-w-[720px] items-center gap-4 rounded-[24px] border border-hairline bg-white py-3 pr-3 pl-[26px] shadow-hero"
      >
        <input
          value={state.draft}
          onChange={(event) => setDraft(event.target.value)}
          name="ask"
          aria-label="Describe the device you want"
          placeholder="I want a sensor that tells me when my greenhouse soil is dry…"
          className="min-w-0 flex-1 bg-transparent py-3.5 text-[19px] text-ink outline-none"
        />
        <Button type="submit" variant="coral" className="rounded-2xl px-[26px] py-[15px] text-[17px] font-semibold">
          Start building
        </Button>
      </form>

      {/* The first send failed before the chat started: the draft is back in the input. */}
      {state.error ? (
        <p role="alert" className="mt-4 text-[15px] text-coral-deep">
          {state.error}
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap justify-center gap-2.5">
        {STARTERS.map((label) => (
          <button
            key={label}
            type="button"
            onClick={() => send(label)}
            className="rounded-full border border-hairline bg-white px-[18px] py-2 text-[14px] text-muted hover:border-coral hover:text-coral-deep"
          >
            {label}
          </button>
        ))}
      </div>
    </>
  );
}
