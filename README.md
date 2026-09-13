# Albus Forge

**One question in. Cart, enclosure, firmware, dashboard out.**

A plain-language question becomes four artifacts: a parts cart of real components from a curated
registry, a 3D-printable enclosure generated around those exact parts, working firmware where only
the app layer is generated, and an optional cloud tier with dashboards and alerts.

## The core invariant

> One data object — the **Part Definition** — threads through every service. No service may
> hard-code knowledge about a specific part. Everything reads the registry.

## Status

Pre-M0. Architecture defined. The workspace root and the portal ([`apps/web`](apps/web/)) are
scaffolded against mock data; no backend service exists yet. See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), and §18 in particular — several forks (firmware
target, tenant-vs-build root, first-party vs partner cloud) should be settled before M0 goes further.

## Running the portal

Node 22 and pnpm (the version is pinned in `package.json`; `corepack enable` picks it up).

```sh
pnpm install
pnpm dev          # http://localhost:3000 — mock API data, no gateway needed
```

`pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` run across the workspace through turbo.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — full system architecture
- [`docs/CLOUD-PLATFORM.md`](docs/CLOUD-PLATFORM.md) — ingestion, storage, the dashboard, and the intelligence layer
- [`docs/adr/`](docs/adr/) — architecture decision records
- [`infra/`](infra/) — Terraform for GCP (M0 scope today)

## Convention

Every directory in this repo contains its own `README.md` describing what lives there.
