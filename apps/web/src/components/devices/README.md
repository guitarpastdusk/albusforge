# src/components/devices/

- `DeviceTileBody` — the inside of a Live systems tile: name, value with unit, metric and age. A `never_seen` device (or one with no `last_reading_at`) shows "Awaiting first reading" instead of a value and age, and no online pulse.
- `DeviceStatusHeader` — the device dashboard's status line and name: "Online · last reading 40s ago", "Offline · …", or "Awaiting first reading" in muted grey.

Both take `now` from the server render, so the ages are deterministic. Render tests in `devices.test.tsx`.
