# src/components/carousel/

- `DeviceCarousel` — "Live right now", or with `examples` (gateway's showcase isn't built yet): "Example builds — real designs, sample readings", no live pulse, and each card links to its build in the Marketplace. 340px cards, 20px gap, one position = 360px, `.6s` carousel easing. Auto-advances every 3.5s; pauses on hover or focus and never auto-advances under `prefers-reduced-motion`. Arrows wrap; dots jump. The track repeats the first three cards so the last positions never show blank space.
- `SchematicChain` — the three mono nodes (sensor ─ brain ─ output) joined by dashed coral wires; the last node is ink-filled.

Cards arrive with `age` already formatted by the server, so server and client render the same text.
