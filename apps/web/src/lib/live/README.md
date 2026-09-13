# src/lib/live/

Live values on the Live systems and device dashboard screens, over the tenant stream `GET /v1/tenants/:id/stream` (CLOUD-PLATFORM.md §6.2).

- `useLiveStream` — one subscription per screen on top of `lib/sse/useEventStream`: validates `reading` and `status` payloads against `@albusforge/schema`, hands them to the screen's handlers, and refreshes the page on every re-open after the first, because events sent while the stream was closed aren't replayed. Returns whether the stream has opened.
- `live-fleet.ts` — pure: apply an event to the `Fleet` snapshot. A reading on a tile's `channel` reformats its value the way gateway did; any reading refreshes the age and marks the device online; the header's online ratio is recomputed from the tiles.
- `live-dashboard.ts` — pure: apply an event to a `DeviceDashboard`. A reading updates `latest` and the chart series (replacing the last point inside the same 1m/1h bucket, appending otherwise, trimming to the widget's window). Events for other devices are ignored; a reading older than what's shown is dropped.
- `useNow` — a ticking clock that starts at the server's `now`, so ages hydrate identically and then advance.

Locally, `/v1` isn't routed to gateway, so `app/v1/tenants/[tenantId]/stream/route.ts` serves the stream: synthetic events in mock mode, a proxy to gateway in live mode. On staging and prod the load balancer sends `/v1/*` to gateway and that route handler is never reached (ADR 0007).
