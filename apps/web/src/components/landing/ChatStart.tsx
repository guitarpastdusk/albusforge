"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui";

const STARTERS = [
  "A sensor that texts me when the fridge door is left open",
  "Monitor vibration on my workshop compressor",
  "Track light + humidity for my orchids",
];

export function ChatStart() {
  const router = useRouter();
  const [text, setText] = useState("");

  function start(ask: string) {
    if (!ask.trim()) return;
    // TODO(M2): POST /v1/builds { ask_text: ask } and open the returned build_id.
    router.push("/build/mock-build");
  }

  return (
    <>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          start(text);
        }}
        className="mt-9 flex w-full max-w-[720px] items-center gap-4 rounded-[24px] border border-hairline bg-white py-3 pr-3 pl-[26px] shadow-hero"
      >
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          aria-label="Describe the device you want"
          placeholder="I want a sensor that tells me when my greenhouse soil is dry…"
          className="min-w-0 flex-1 bg-transparent py-3.5 text-[19px] text-ink outline-none"
        />
        <Button type="submit" variant="coral" className="rounded-2xl px-[26px] py-[15px] text-[17px] font-semibold">
          Start building
        </Button>
      </form>

      <div className="mt-5 flex flex-wrap justify-center gap-2.5">
        {STARTERS.map((label) => (
          <button
            key={label}
            type="button"
            onClick={() => start(label)}
            className="rounded-full border border-hairline bg-white px-[18px] py-2 text-[14px] text-muted hover:border-coral hover:text-coral-deep"
          >
            {label}
          </button>
        ))}
      </div>
    </>
  );
}
