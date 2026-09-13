# src/components/devices/

The Live systems tiles and the device dashboard.

- `LiveFleet` — the Live systems screen (client): the server-rendered `Fleet` plus `reading`/`status` events from the tenant stream (`lib/live`), ages ticking, "· live" in the kicker once the stream is open. Keyed by tenant on the page.
- `LiveDashboard` — the dashboard's status line, chips and widgets with live values for one device; the rules card and chat are passed through as `below` and `aside`. Keyed by tenant and device on the page.
- `LiveConnection` — accessible connection status, retry on stream errors and manual refresh. Rapid reading updates are not announced as a whole-page live region.
- `DeviceTileBody` — the inside of a Live systems tile: name, value with unit, metric and age. A `never_seen` device (or one with no `last_reading_at`) shows "Awaiting first reading" instead of a value and age, and no online pulse.
- `DeviceStatusHeader` — the dashboard's status line and name: "Online · last reading 40s ago", "Offline · …", or "Awaiting first reading" in muted grey.
- `DeviceWidgets` — renders the dashboard's widget config in order (PORTAL.md §6): `LineChartCard` for `line_chart` (SVG polyline, dashed threshold on the true scale, current value) and a grid of `StatTile`s for consecutive `stat` widgets. Nothing about which widgets a device has is hard-coded; a widget without a reading says "Awaiting first reading".
- `ClosedLoopActions` — the "Closed loop · actions" card (ADR 0010): kind pill, rule, "via" line and a `Toggle` per rule, an "applies at next check-in" badge while `sync` is `pending`, and the composer behind "+ New action". Switches write through `setActionEnabled` in `src/actions/device-actions.ts` optimistically and roll back with the refusal shown. `RuleComposer` is plain words → `proposeAction` → `ProposalCard` (normalized rule, summary, issues) → `confirmAction`; a proposal with issues can't be confirmed. `canEdit` is the dashboard's `permissions.edit_actions`; without it the card is read-only with a "Read-only" badge and says why. The page shows the card when the device has rules or the session may add one. Pure helpers in `closed-loop-flow.ts`.
- `DeviceChat` — the sticky dark chat panel. Opens with the dashboard's `greeting`; questions go to `askDevice` in `src/actions/devices.ts` through `askOnce` (`device-chat-flow.ts`), which never rejects: a failure returns the question to the input with a retryable message, and Ask is re-enabled.

Ages are formatted with `now` from the server render, so they're deterministic. Tests in `devices.test.tsx`, `dashboard.test.tsx`, `closed-loop.test.tsx` and `device-chat.test.ts`.
