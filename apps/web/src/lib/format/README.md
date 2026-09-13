# src/lib/format/

Display formatting shared by every screen: `formatAgo` (short for live readings, long for project activity), `pluralize` ("1 device" / "4 devices"), `formatCompact` ("2.4k"), `formatBytes` ("48.3 MB"), and device status — `isAwaitingFirstReading`, `formatDeviceStatus` — where `never_seen` or a null timestamp means "Awaiting first reading". Tests in `format.test.ts`.
