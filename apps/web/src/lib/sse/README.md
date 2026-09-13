# src/lib/sse/

`useEventStream` — the single Server-Sent Events hook. Build progress (`/v1/builds/:id/events`) and live readings (`/v1/tenants/:id/stream`) both use it; there is no WebSocket tier and no polling (CLOUD-PLATFORM.md §6.2).

- `path` is same-origin `/v1/...`, so the host-only `__Host-` cookies go with it.
- `parse` — per event name, shape the JSON payload (e.g. a schema's `safeParse`) or return `undefined` to drop one that doesn't match.
- `onOpen` — fires on every open: first connect, a browser reconnect, and reopening after the tab was hidden. Refetch there: events sent while no stream was open aren't replayed on a fresh connection.
- The stream closes while the tab is hidden and reopens when it's visible. A dropped connection is retried by the browser, which resends `Last-Event-ID`.

Tests in `useEventStream.test.tsx` (happy-dom, a fake EventSource).
