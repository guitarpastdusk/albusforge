# src/lib/live/

Live values on the fleet and device dashboard, over `GET /v1/tenants/:id/stream` (CLOUD-PLATFORM.md §6.2).

- `useLiveStream` validates named `reading`/`status` events, scopes one connection to the sorted unique visible device IDs, and refreshes on every open to close the initial snapshot/subscription gap and recover after disconnects. Connection state distinguishes connecting, open, reconnecting, hidden-tab pause and terminal failure. Retry replaces the source; Refresh fetches a new snapshot. No polling.
- `live-fleet.ts` formats the displayed channel while tracking `value_at` separately from the device's latest reading time. Older/duplicate samples do not replace newer values. Other channels can advance the device age without suppressing a later arrival for the displayed channel. Numeric/status types must match channel metadata; valid ranges describe display expectations, not an outlier filter.
- `live-dashboard.ts` updates known channels only. Delayed readings enter raw history without advancing latest values or presence. Snapshot reconciliation unions these samples with incoming raw history, preferring snapshot values at matching timestamps. Raw series are sorted, deduplicated and bounded to the widget window and 600 points. Server `1m`/`1h` aggregates are never overwritten by raw samples: the current value updates live, while historical averages update on explicit refresh or reconnect.
- Both reducers order presence by `status.at` independently of measurement time. An old replay or delayed measurement cannot resurrect a device observed offline more recently. Snapshot reconciliation accepts new membership, metadata, permissions and rollups while preserving readings/presence with newer timestamps. `status_at` and `value_at` are optional snapshot additions; older snapshots fall back to `last_reading_at`. Producers should supply both when channels/presence have different timestamps. Removed devices/channels are not restored by reconciliation.
- `useNow` starts at the server render's clock and advances ages every five seconds.

## Stream contract and integration boundary

`reading`: `{ device_id, channel, v, t }`. `status`: `{ device_id, status, at, last_reading_at }`, where `at` is the presence observation timestamp. The server must scope devices to the authenticated tenant and replay current state on reconnect. This new telemetry stream contract is separate from the merged M2 build conversation stream.

The gateway tenant stream and real device dashboard/fleet endpoints remain unimplemented in this change. Local mock mode supplies synthetic readings; local live mode uses the merged authenticated `proxyGatewayStream` and preserves upstream failures without a mock fallback. Staging/prod route `/v1/*` directly to gateway (ADR 0007). Mock mode is forbidden on Cloud Run. This PR demonstrates UI behavior, not hardware ingestion or a working deployed telemetry pipeline.

Tests cover ordering, stale snapshot reconciliation, raw/aggregate separation, channel types, source cleanup, retries, visibility changes, malformed events, empty fleets, proxy forwarding/failures, and mock stream/snapshot consistency across separate module graphs.
