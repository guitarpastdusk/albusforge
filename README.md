# Albus Forge

**One question in. Cart, enclosure, firmware, dashboard out.**

A plain-language question becomes four artifacts: a parts cart of real components from a curated
registry, a 3D-printable enclosure generated around those exact parts, working firmware where only
the app layer is generated, and an optional cloud tier with dashboards and alerts.

## The core invariant

> One data object — the **Part Definition** — threads through every service. No service may
> hard-code knowledge about a specific part. Everything reads the registry.

## Status

Pre-M0. Architecture defined; no code yet. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md),
and §18 in particular — several forks (firmware target, tenant-vs-build root, first-party vs
partner cloud) should be settled before M0 lays down the workspace.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — full system architecture
- `docs/adr/` — architecture decision records (as decisions are made)

## Convention

Every directory in this repo contains its own `README.md` describing what lives there.
