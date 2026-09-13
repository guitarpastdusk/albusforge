"use client";

import { useEffect, useEffectEvent } from "react";

export interface EventStreamOptions {
  /** SSE event names to listen for. */
  events: readonly string[];
  onEvent: (type: string, data: unknown) => void;
  enabled?: boolean;
}

/**
 * One EventSource per stream, for build progress and device telemetry alike —
 * the same mechanism and client code (CLOUD-PLATFORM.md §6.2). `path` is a
 * same-origin `/v1/...` URL, so the host-only session cookie goes with it.
 *
 * TODO: validate payloads against @albusforge/schema event types, back off on
 * reconnect, and close the stream while the tab is hidden.
 */
export function useEventStream(path: string | null, { events, onEvent, enabled = true }: EventStreamOptions): void {
  const emit = useEffectEvent(onEvent);
  const eventsKey = events.join(",");

  useEffect(() => {
    if (!path || !enabled) return;

    const source = new EventSource(path);
    const listeners = eventsKey
      .split(",")
      .filter(Boolean)
      .map((type) => {
        const listener = (event: MessageEvent<string>) => {
          let data: unknown = event.data;
          try {
            data = JSON.parse(event.data);
          } catch {
            // Plain-text event; pass it through as a string.
          }
          emit(type, data);
        };
        source.addEventListener(type, listener);
        return [type, listener] as const;
      });

    return () => {
      for (const [type, listener] of listeners) source.removeEventListener(type, listener);
      source.close();
    };
  }, [path, enabled, eventsKey]);
}
