"use client";

import { DeviceStatusEvent, ReadingEvent, routes, STREAM_EVENTS } from "@albusforge/schema";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useEventStream } from "@/lib/sse/useEventStream";

export interface LiveStreamHandlers {
  onReading: (event: ReadingEvent) => void;
  onStatus: (event: DeviceStatusEvent) => void;
}

const parse = {
  [STREAM_EVENTS.reading]: (data: unknown) => ReadingEvent.safeParse(data).data,
  [STREAM_EVENTS.status]: (data: unknown) => DeviceStatusEvent.safeParse(data).data,
};

/**
 * The tenant's live stream for a screen: validated `reading` and `status`
 * events to the handlers, and a page refresh on every re-open after the first
 * (a browser reconnect, or the tab coming back), since events sent while no
 * stream was open aren't replayed. Returns whether the stream has opened, for
 * a "live" indicator.
 */
export function useLiveStream(tenantId: string | null, devices: readonly string[], { onReading, onStatus }: LiveStreamHandlers): boolean {
  const router = useRouter();
  const [live, setLive] = useState(false);
  const opens = useRef(0);
  const path = tenantId ? `${routes.tenants.stream.path(tenantId)}?devices=${devices.map(encodeURIComponent).join(",")}` : null;

  useEventStream(path, {
    events: [STREAM_EVENTS.reading, STREAM_EVENTS.status],
    parse,
    onOpen: () => {
      setLive(true);
      if (opens.current > 0) router.refresh();
      opens.current += 1;
    },
    onEvent: (type, data) => {
      if (type === STREAM_EVENTS.reading) onReading(data as ReadingEvent);
      else if (type === STREAM_EVENTS.status) onStatus(data as DeviceStatusEvent);
    },
  });

  return live;
}
