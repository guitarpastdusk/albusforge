# Existing-device setup and first-reading confirmation

Delivered scope: `/setup?device=UUID` checks a device already registered in the active workspace. It does not enroll devices, issue credentials, transfer ownership, flash firmware or validate physical hardware. This is the cloud-reception portion of [UI-BACKLOG B8](UI-BACKLOG.md).

## Contract and dependencies

[CLOUD-PLATFORM §4.2](CLOUD-PLATFORM.md) assigns paid-device identity provisioning to fulfillment from a pinned BuildPlan, with credentials baked into firmware. [ADR 0009](adr/0009-tenant-created-at-sign-up.md) requires tenant ownership from the build; a future self-flash claim must have the same session tenant as the build. A UUID lookup here cannot claim an arbitrary device.

The remaining dependency chain is tracked in the existing documents, not a newly created issue:

| Dependency | Meaning and current gap | Existing tracker |
| --- | --- | --- |
| Persisted trusted BuildPlan | A server-owned, validated and pinned plan must supply the board/channel/source facts used for a production identity. Existing untyped plan JSON is not a completed trusted provisioning contract. | UI-BACKLOG B3, CLOUD-PLATFORM §4.2 |
| Trusted provisioning producer | Fulfillment/self-flash needs an authorized producer that derives immutable device channels/source and tenant ownership from that plan. The local Cloudlink simulator CLI is not this producer. | UI-BACKLOG B6/B8, CLOUD-PLATFORM §4.2, ADR 0009 |
| Firmware credential handoff | The provisioner must securely deliver the device's secret identity to generated firmware without exposing it through browser status APIs, logs or support copy. Firmware generation, flashing and self-flash claim issuance are still missing here. | UI-BACKLOG B6/B8, CLOUD-PLATFORM §4.2 |

No migration or credential lifecycle is introduced. Fleet metadata is a separate workstream and does not alter channels/source.

## API and state semantics

`GET /v1/devices/:id/setup` requires the existing session cookie and current tenant membership. Viewer access is sufficient for this read. Tenant identity comes from the session, never a query parameter. Extra query keys and malformed UUIDs are rejected. Foreign and unknown devices return the same opaque 404. Responses, including failures, are `private, no-store`.

`DeviceSetupStatus` in `packages/schema` exposes only device ID, registration/check/last-packet timestamps, configured upload interval, revocation timestamp, receipt presence and up to 64 registered channel names/units/latest samples. It never selects credential hashes or private source JSON. The read uses the existing consistent read-only session transaction; no raw partitions are accessed.

| State | Evidence |
| --- | --- |
| `waiting_for_upload` | No durable accepted packet receipt exists, even if a latest row was inserted separately. |
| `waiting_for_channels` | An accepted receipt exists, but at least one registered channel lacks a latest sample. |
| `confirmed` | An accepted receipt and a latest sample for every registered channel exist. |
| `credential_revoked` | The device credential is revoked; this takes precedence over historical reception. |

Receipt presence uses the packet primary key's device prefix with `EXISTS`, rather than scanning/counting history or inventing a first-ever receipt timestamp. Latest samples use the existing bounded device/channel index. Last packet time is the ingestion-maintained `last_seen_at`; sample timestamps can be older because of backfill. Confirmation is historical cloud reception, not a promise that a device is currently online, physically correct, calibrated or safely flashed. No new retention or receipt semantics are introduced.

## User flow and recovery

Sign in and open a registered device's setup link from Live systems, or enter its full UUID on `/setup`. Sign-in preserves the setup destination. Missing or foreign IDs receive the same unavailable message. A service outage is distinct from waiting for an upload; unexpected errors reach the existing app recovery boundary.

For waiting devices, the visible page refreshes every five seconds, pauses while hidden, and stops after 60 automatic checks. A manual **Check again** restarts the budget. Completion and revocation stop automatic checks. Channel values preserve zero and show stored sample timestamps; the history link remains available for revoked devices.

Use the provisioner's existing power/network/firmware instructions. Never paste a device secret into this screen or a support message. If no packet arrives after several configured intervals, ask the provisioner to check identity/endpoint/connectivity. Missing channels require sensor/firmware investigation. Revoked credentials require supported recovery by the provisioner; there is no browser rotation or recovery issuer in this change.

## Reproducible validation

From a frozen install, with Docker available:

```sh
pnpm --filter gateway exec vitest run src/device-setup.db.test.ts
pnpm --filter web exec vitest run src/components/setup/setup.dom.test.tsx 'src/app/(app)/setup/page.test.tsx'
pnpm --filter @albusforge/db build
pnpm --filter gateway build
pnpm --filter web build
pnpm --filter web typecheck:browser
pnpm --filter web test:browser
```

For Colima on macOS, set `DOCKER_HOST=unix://$HOME/.colima/default/docker.sock` and `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock`. A locally installed Chrome can be selected with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`; CI installs Playwright Chromium. See [UI-BROWSER-ACCEPTANCE.md](UI-BROWSER-ACCEPTANCE.md) for the common stack and artifacts.

The database test uses real PostgreSQL 16 and the actual Cloudlink handler for unauthorized upload, partial/complete reception, zero samples and revoked credential schedules. It also tests absent/anonymous/revoked sessions, removed membership, foreign/unknown opacity, query validation, secret-free output and seeded-latest-without-receipt behavior.

The committed `apps/web/e2e/device-setup.spec.ts` starts production Next and the bundled gateway against disposable PostgreSQL, uses actual email-code authentication with the native local email sink, and serves the actual Cloudlink HTTP handler on a local port. Only the existing registration is seeded; Cloudlink produces every receipt/latest/raw sample in this journey. The browser verifies automatic waiting-to-partial-to-confirmed progression, revocation, history navigation, secret-free markup, and 1440/390/320 pixel layouts with screenshots. It uses no deployed writes, paid provider, physical device or trusted firmware producer. The scoped browser CI workflow includes Cloudlink changes because that handler is now part of the acceptance boundary.
