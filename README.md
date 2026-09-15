# Albus Forge

**One question in. Cart, enclosure, firmware, dashboard out.**

A plain-language question becomes four artifacts: a parts cart of real components from a curated
registry, a 3D-printable enclosure generated around those exact parts, working firmware where only
the app layer is generated, and an optional cloud tier with dashboards and alerts.

## The core invariant

> One data object — the **Part Definition** — threads through every service. No service may
> hard-code knowledge about a specific part. Everything reads the registry.

## Status

**Live in production.** Five Cloud Run services (`web`, `gateway`, `intake`, `ask`, `cloudlink`)
and four jobs run in both environments from Terraform, with images built by CI and promoted to
production by digest.

Working end to end today: ask for a device and get a plan solved against the real parts catalogue,
sign in, workspaces and tenants, telemetry ingest with partitioned storage and rollups, fleet and
history APIs, and questions answered from your own stored readings.

Merged and tested but not switched on: firmware compilation (the `fwbuild` job is not deployed),
camera observations (behind a flag), and the multi-turn device chat. No physical board has yet run
our own firmware — [`hardware/freenove/`](hardware/freenove/) has a real device on ESPHome and the
gates before it may reach production.

See [`docs/checkin/`](docs/checkin/) for what landed when, and
[`docs/DEMO-ASSUMPTIONS.md`](docs/DEMO-ASSUMPTIONS.md) before quoting any registry number as fact —
it records every guessed, estimated and mocked value with what would replace it.

## Running the portal

Node 22 and pnpm (the version is pinned in `package.json`; `corepack enable` picks it up).

```sh
pnpm install
pnpm dev          # http://localhost:3000 — mock API data, no gateway needed
```

For the full stack, `docker compose up -d` brings up PostgreSQL, Redis, MinIO and EMQX; migrate and
load the registry before starting the services.

`pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` run across the workspace through turbo.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — full system architecture
- [`docs/CLOUD-PLATFORM.md`](docs/CLOUD-PLATFORM.md) — ingestion, storage, the dashboard, and the intelligence layer
- [`docs/`](docs/) — one document per surface: telemetry, firmware, provisioning, observations, portal
- [`docs/adr/`](docs/adr/) — architecture decision records
- [`docs/checkin/`](docs/checkin/) — hackathon submissions, each fixed to a git snapshot
- [`infra/`](infra/) — Terraform for GCP

## Convention

Every directory in this repo contains its own `README.md` describing what lives there.
