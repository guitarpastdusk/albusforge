"use client";

import { useState } from "react";
import { askDevice } from "@/actions/devices";
import { Button } from "@/components/ui";
import { cx } from "@/lib/cx";

interface Line {
  id: string;
  from: "device" | "me";
  text: string;
}

/** The dark "Chat with this device" panel. Questions go to POST /v1/devices/:id/ask through a Server Function. */
export function DeviceChat({ deviceId, greeting }: { deviceId: string; greeting: string }) {
  const [lines, setLines] = useState<Line[]>([{ id: "greeting", from: "device", text: greeting }]);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);

  const ask = async (value: string) => {
    const question = value.trim();
    if (!question || pending) return;
    setText("");
    setPending(true);
    setLines((current) => [...current, { id: `me-${current.length}`, from: "me", text: question }]);
    const result = await askDevice(deviceId, question);
    setPending(false);
    setLines((current) => [
      ...current,
      { id: `device-${current.length}`, from: "device", text: result.ok ? result.data.text : result.message },
    ]);
  };

  return (
    <aside
      aria-label="Chat with this device"
      className="flex min-h-[566px] flex-col rounded-[24px] bg-ink px-[26px] pt-[26px] pb-5 lg:sticky lg:top-[96px]"
    >
      <h2 className="font-mono text-[13px] uppercase tracking-[0.18em] text-coral">Chat with this device</h2>
      <div className="mt-[18px] flex flex-1 flex-col gap-3 overflow-auto" aria-live="polite">
        {lines.map((line) => (
          <div key={line.id} className={cx("flex", line.from === "me" ? "justify-end" : "justify-start")}>
            <div
              className={cx(
                "max-w-[calc(85%+32px)] whitespace-pre-line px-4 py-3 text-[15px] font-light leading-[1.45]",
                line.from === "me"
                  ? "rounded-[14px_14px_4px_14px] bg-coral text-white"
                  : "rounded-[14px_14px_14px_4px] bg-ink-2 text-on-ink",
              )}
            >
              {line.text}
            </div>
          </div>
        ))}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          // Read the field, not `text`: an Enter right after typing can fire before React re-renders.
          void ask(String(new FormData(event.currentTarget).get("question") ?? ""));
        }}
        className="mt-4 flex items-center gap-2.5 rounded-[14px] bg-ink-2 py-1.5 pr-1.5 pl-4"
      >
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          name="question"
          aria-label="Ask this device"
          placeholder="Ask about readings, thresholds…"
          className="min-w-0 flex-1 bg-transparent py-2.5 text-[15px] text-white outline-none"
        />
        <Button type="submit" variant="coral" disabled={pending} className="rounded-[10px] px-4 py-2.5 text-[14px] font-semibold">
          Ask
        </Button>
      </form>
    </aside>
  );
}
