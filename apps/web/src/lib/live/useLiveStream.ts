"use client";

import { DeviceStatusEvent, ReadingEvent, routes, STREAM_EVENTS } from "@albusforge/schema";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useEventStream, type StreamState } from "@/lib/sse/useEventStream";

export interface LiveStreamHandlers {
  onReading: (event: ReadingEvent) => void;
  onStatus: (event: DeviceStatusEvent) => void;
}

const parse = {
  [STREAM_EVENTS.reading]: (data: unknown) => ReadingEvent.safeParse(data).data,
  [STREAM_EVENTS.status]: (data: unknown) => DeviceStatusEvent.safeParse(data).data,
};

/** Validated live events; refresh on every open to close the snapshot/subscription gap. */
export function useLiveStream(tenantId: string | null, devices: readonly string[], { onReading, onStatus }: LiveStreamHandlers) {
  const router = useRouter();
  const [connection, setConnection] = useState<{ path: string | null; state: StreamState }>({ path: null, state: "connecting" });
  const [reconnectKey, setReconnectKey] = useState(0);
  const path = tenantId && devices.length ? `${routes.tenants.stream.path(tenantId)}?devices=${[...new Set(devices)].sort().map(encodeURIComponent).join(",")}` : null;

  useEventStream(path, {
    events: [STREAM_EVENTS.reading, STREAM_EVENTS.status],
    parse,
    reconnectKey,
    onState: (state) => setConnection({ path, state }),
    onOpen: () => router.refresh(),
    onEvent: (type, data) => {
      if (type === STREAM_EVENTS.reading) onReading(data as ReadingEvent);
      else if (type === STREAM_EVENTS.status) onStatus(data as DeviceStatusEvent);
    },
  });

  return {
    state: connection.path === path ? connection.state : "connecting" as const,
    retry: () => setReconnectKey((key) => key + 1),
    refresh: () => router.refresh(),
  };
}
