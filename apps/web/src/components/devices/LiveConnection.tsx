"use client";

import type { StreamState } from "@/lib/sse/useEventStream";

const labels: Record<StreamState, string> = {
  connecting: "Connecting to live readings…",
  open: "Live readings connected",
  reconnecting: "Reconnecting — showing last received readings",
  paused: "Live readings paused while this tab is hidden",
  unavailable: "Live readings unavailable — showing last received readings",
};

export function LiveConnection({ state, retry, refresh }: { state: StreamState; retry: () => void; refresh: () => void }) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-muted">
      <span role="status">{labels[state]}</span>
      {state === "unavailable" || state === "reconnecting" ? (
        <button type="button" onClick={retry} className="rounded border border-hairline px-3 py-1 text-ink">Retry connection</button>
      ) : null}
      <button type="button" onClick={refresh} className="rounded border border-hairline px-3 py-1 text-ink">Refresh</button>
    </div>
  );
}
