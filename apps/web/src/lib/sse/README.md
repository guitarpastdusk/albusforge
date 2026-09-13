# src/lib/sse/

`useEventStream` — the single Server-Sent Events hook. Build progress (`/v1/builds/:id/events`) and live readings (`/v1/tenants/:id/stream`) both use it; there is no WebSocket tier and no polling (CLOUD-PLATFORM.md §6.2). A placeholder today: wiring only, no screen subscribes yet.
