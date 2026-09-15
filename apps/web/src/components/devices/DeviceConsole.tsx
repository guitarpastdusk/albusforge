"use client";

import { useEffect, useRef, useState } from "react";
import type { ConverseQuery, ConverseTurn } from "@albusforge/schema";
import { chatWithDevice } from "@/actions/devices";
import { Button } from "@/components/ui";
import { cx } from "@/lib/cx";

interface Line {
  id: string;
  from: "device" | "me";
  text: string;
  /** Which windows the answer was written from. Absent on questions and on the greeting. */
  queries?: ConverseQuery[];
  /** The model answered without reading anything, or could not answer at all. */
  caveat?: "no_tool" | "unavailable";
}

/** History sent upstream is capped by the schema; keep the tail, which is the part that carries the thread. */
const HISTORY_TURNS = 20;

function windowLabel(query: ConverseQuery): string {
  if (!query.from || !query.to) return query.tool.replace(/_/g, " ");
  const from = new Date(query.from),
    to = new Date(query.to);
  const hours = (to.getTime() - from.getTime()) / 3600000;
  const span = hours < 1 ? `${Math.round(hours * 60)} min` : hours < 48 ? `${Math.round(hours)} h` : `${Math.round(hours / 24)} d`;
  return `${query.channel ?? "readings"} · ${span} to ${to.toISOString().replace("T", " ").slice(0, 16)}Z${
    query.points === null ? "" : ` · ${query.points} pts`
  }`;
}

/**
 * The conversation panel beside the plots. Every turn replays the visible
 * history, because the service stores none of it: reloading the page starts a
 * new conversation, and nothing said here can be recovered from the server.
 */
export function DeviceConsole({ deviceId, deviceName, channelCount }: { deviceId: string; deviceName: string; channelCount: number }) {
  const [lines, setLines] = useState<Line[]>([
    {
      id: "greeting",
      from: "device",
      text:
        channelCount > 0
          ? `Ask me about ${deviceName}. I can read its ${channelCount === 1 ? "channel" : `${channelCount} channels`}, compare time ranges and check when it last reported.`
          : `${deviceName} has not stored any readings yet. I can still tell you its status and when it last reported.`,
    },
  ]);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const feed = useRef<HTMLDivElement>(null);

  // Follow the conversation as it grows, without yanking the whole page.
  useEffect(() => {
    feed.current?.scrollTo({ top: feed.current.scrollHeight, behavior: "smooth" });
  }, [lines, pending]);

  const send = async (value: string) => {
    const question = value.trim();
    if (!question || pending) return;
    const id = `me-${Date.now()}`;
    // Snapshot before the optimistic append: the model must not be shown the
    // question twice, once as history and once as the question.
    const history: ConverseTurn[] = lines
      .filter((line) => line.id !== "greeting")
      .slice(-HISTORY_TURNS)
      .map((line) => ({ role: line.from === "me" ? ("user" as const) : ("assistant" as const), text: line.text }));
    setText("");
    setError(null);
    setPending(true);
    setLines((current) => [...current, { id, from: "me", text: question }]);
    try {
      const outcome = await chatWithDevice(deviceId, question, history);
      if (outcome.ok) {
        setLines((current) => [
          ...current,
          {
            id: `device-${id}`,
            from: "device",
            text: outcome.data.reply,
            queries: outcome.data.queries,
            caveat: outcome.data.mode === "model" ? undefined : outcome.data.mode,
          },
        ]);
      } else {
        // Unanswered: take the question back out and return it to the box, so
        // retrying does not need it retyped and history stays truthful.
        setLines((current) => current.filter((line) => line.id !== id));
        setText((draft) => draft || question);
        setError(outcome.message);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <aside
      aria-label={`Chat about ${deviceName}`}
      className="flex min-w-0 [overflow-wrap:anywhere] h-[min(78vh,760px)] flex-col rounded-[24px] bg-ink px-[26px] pt-[26px] pb-5 lg:sticky lg:top-[96px]"
    >
      <h2 className="font-mono text-[13px] uppercase tracking-[0.18em] text-coral">Ask about this device</h2>
      <p className="mt-2 text-[13px] text-muted">
        Answers are written from queries run against your stored readings. Nothing here is saved; reloading starts over.
      </p>

      <div ref={feed} className="mt-[18px] flex flex-1 flex-col gap-3 overflow-y-auto pr-1" aria-live="polite">
        {lines.map((line) => (
          <div key={line.id} className={cx("flex flex-col", line.from === "me" ? "items-end" : "items-start")}>
            <div
              className={cx(
                "max-w-[92%] whitespace-pre-line px-4 py-3 text-[15px] font-light leading-[1.45]",
                line.from === "me" ? "rounded-[14px_14px_4px_14px] bg-coral text-white" : "rounded-[14px_14px_14px_4px] bg-ink-2 text-on-ink",
              )}
            >
              {line.text}
            </div>
            {line.caveat ? (
              <p className="mt-1.5 text-[12px] text-muted">
                {line.caveat === "no_tool"
                  ? "Answered without reading any stored readings."
                  : "The assistant was unavailable; this is a direct summary, not a written answer."}
              </p>
            ) : null}
            {line.queries?.length ? (
              <details className="mt-1.5 max-w-[92%] text-[12px] text-muted">
                <summary className="cursor-pointer select-none">
                  Read {line.queries.length} {line.queries.length === 1 ? "query" : "queries"}
                </summary>
                <ul className="mt-1 space-y-0.5 font-mono">
                  {line.queries.map((query, index) => (
                    <li key={`${line.id}-q${index}`}>{windowLabel(query)}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ))}
        {pending ? (
          <p className="text-[14px] text-muted" role="status">
            Reading the device’s history…
          </p>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-[14px] text-coral">
          {error}
        </p>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          // Read the field, not `text`: Enter can fire before React re-renders.
          void send(String(new FormData(event.currentTarget).get("question") ?? ""));
        }}
        className="mt-4 flex items-center gap-2.5 rounded-[14px] bg-ink-2 py-1.5 pr-1.5 pl-4"
      >
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          name="question"
          maxLength={4000}
          autoComplete="off"
          aria-label={`Ask about ${deviceName}`}
          placeholder="How has humidity changed this week?"
          className="min-w-0 flex-1 bg-transparent py-2.5 text-[15px] text-white outline-none"
        />
        <Button type="submit" variant="coral" disabled={pending} className="rounded-[10px] px-4 py-2.5 text-[14px] font-semibold">
          {pending ? "…" : "Ask"}
        </Button>
      </form>
    </aside>
  );
}
