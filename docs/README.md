# docs/

Design and architecture documentation for Albus Forge.

| File | What it covers |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System architecture: the core invariant, the six-stage pipeline, services, data model, API contract, infrastructure, and the open forks that must be settled before M0. |
| [CLOUD-PLATFORM.md](CLOUD-PLATFORM.md) | The cloud tier end to end: transport (MQTT vs HTTPS), the wire envelope, ingestion, storage tiering and retention, how readings reach the UI, and the three-tier intelligence layer — statistics, small model, frontier model. |

Both documents carry mermaid diagrams — data flow, service topology, the ER model, GCP components, and the cloud paths. GitHub renders these inline; all 19 are validated against mermaid 11.

Source material: the Albus Forge backend spec v1.0, the GCP build plan v1.0 (decisions dated 2026-08-10), and the investor deck v1.
Where the three disagree, `ARCHITECTURE.md` records both positions rather than silently picking one — see §12.
