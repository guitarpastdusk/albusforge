# src/components/devices/

The Live systems tiles and the device dashboard.

- `DeviceTileBody` — the inside of a Live systems tile: name, value with unit, metric and age. A `never_seen` device (or one with no `last_reading_at`) shows "Awaiting first reading" instead of a value and age, and no online pulse.
- `DeviceStatusHeader` — the dashboard's status line and name: "Online · last reading 40s ago", "Offline · …", or "Awaiting first reading" in muted grey.
- `DeviceWidgets` — renders the dashboard's widget config in order (PORTAL.md §6): `LineChartCard` for `line_chart` (SVG polyline, dashed threshold, current value) and a grid of `StatTile`s for consecutive `stat` widgets. Nothing about which widgets a device has is hard-coded; a widget without a reading says "Awaiting first reading".
- `ClosedLoopActions` — the "Closed loop · actions" card: kind pill, rule, "via" line and a `Toggle` per action, plus the "+ New action" footer. Toggles are local state; there is no API route for actions yet (TODO in the component and schema).
- `DeviceChat` — the sticky dark chat panel. Opens with the dashboard's `greeting`; questions go to `askDevice` in `src/actions/devices.ts`.

Ages are formatted with `now` from the server render, so they're deterministic. Tests in `devices.test.tsx` and `dashboard.test.tsx`.
