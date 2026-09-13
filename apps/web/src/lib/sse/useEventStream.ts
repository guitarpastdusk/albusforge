"use client";

import { useEffect, useEffectEvent } from "react";

export type StreamState = "connecting" | "open" | "reconnecting" | "paused" | "unavailable";

export interface EventStreamOptions {
  onState?: (state: StreamState) => void;
  reconnectKey?: number;
  /** SSE event names to listen for. */
  events: readonly string[];
  onEvent: (type: string, data: unknown) => void;
  /**
   * Per event name: turn the JSON-parsed payload into what `onEvent` receives
   * (a schema's `safeParse`, say), or return undefined to drop a payload that
   * doesn't match. Events without a parser pass through as parsed.
   */
  parse?: Partial<Record<string, (data: unknown) => unknown>>;
  /**
   * Each time the stream opens: the first connect, a browser reconnect, and
   * reopening after the tab was hidden. Events sent while no stream was open
   * aren't replayed on a fresh connection, so refetch what may have been missed.
   */
  onOpen?: () => void;
  enabled?: boolean;
}

/**
 * One EventSource per stream, for build progress and device telemetry alike —
 * the same mechanism and client code (CLOUD-PLATFORM.md §6.2). `path` is a
 * same-origin `/v1/...` URL, so the host-only cookies go with it.
 *
 * While the tab is hidden the stream is closed, so a background tab doesn't
 * hold a connection open; it reopens (and `onOpen` fires) when the tab is
 * visible again. A dropped connection is retried by the browser itself, which
 * resends Last-Event-ID.
 */
export function useEventStream(path: string | null, { events, onEvent, parse, onOpen, onState, reconnectKey = 0, enabled = true }: EventStreamOptions): void {
  const emit = useEffectEvent(onEvent);
  const changed = useEffectEvent((state: StreamState) => onState?.(state));
  const opened = useEffectEvent(() => onOpen?.());
  const parsePayload = useEffectEvent((type: string, data: unknown) => {
    const parser = parse?.[type];
    return parser ? parser(data) : data;
  });
  const eventsKey = events.join(",");

  useEffect(() => {
    if (!path || !enabled) return;
    const types = eventsKey.split(",").filter(Boolean);
    let source: EventSource | null = null;

    const open = () => {
      if (source) return;
      changed("connecting");
      const next = new EventSource(path);
      source = next;
      next.addEventListener("open", () => {
        if (source !== next) return;
        changed("open");
        opened();
      });
      next.addEventListener("error", () => {
        if (source === next) changed(next.readyState === 2 ? "unavailable" : "reconnecting");
      });
      for (const type of types) {
        next.addEventListener(type, (event) => {
          if (source !== next) return;
          const raw = (event as MessageEvent<string>).data;
          let data: unknown = raw;
          try {
            data = JSON.parse(raw);
          } catch {
            // Plain-text event; pass it through as a string.
          }
          const value = parsePayload(type, data);
          if (value !== undefined) emit(type, value);
        });
      }
    };
    const close = () => {
      source?.close();
      source = null;
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        close();
        changed("paused");
      } else open();
    };

    onVisibilityChange();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      close();
    };
  }, [path, enabled, eventsKey, reconnectKey]);
}
