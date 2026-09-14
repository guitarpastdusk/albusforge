# Self-flash device provisioning

Delivered software scope: accepted-plan self-flash registration, encrypted one-time configuration downloads, explicit credential replacement/revocation and setup reception confirmation. These local implementation results do not claim deployed services or physical hardware acceptance.

## Authority and supported path

B3 owns accepted persisted build plans. B6 owns credential-free compiled firmware and its artifact manifest. B8 owns registration, the separately encrypted configuration handoff and setup integration. [CLOUD-PLATFORM §4.2](CLOUD-PLATFORM.md) and [ADR 0009](adr/0009-tenant-created-at-sign-up.md) require device ownership to come from the build's tenant. [UI-BACKLOG B3/B6/B8](UI-BACKLOG.md) track these dependencies; [BUILD-TO-DEVICE-DELIVERY.md](BUILD-TO-DEVICE-DELIVERY.md) coordinates the workstreams.

The supported software flow is self-flash. It requires an accepted plan for the build's latest spec, matching immutable registry evidence, a reviewed versioned channel profile and a passed firmware artifact for that exact plan. A server session in the build's tenant with admin or operator role authorizes registration. Viewer, anonymous, expired, revoked and foreign-tenant credentials cannot register or receive a device secret. The request carries an expected tenant only as a stale-workspace precondition; authorization derives the tenant from the server session. No request body may supply device tokens, channel ranges or part source snapshots.

The checked-in production provisioning profile list is empty. Current registry parts remain drafts and no hardware acceptance is inferred from software fixtures, successful compilation or a first received packet. Production registration must fail closed until approved evidence exists. Paid fulfillment/checkout is separate; this flow does not invent an order or transfer an arbitrary pre-existing device.

## Storage and lifecycle

Migration 0007 follows fleet 0005 and accepted-plan 0006. A separate `telemetry.device_provisionings` record links an immutable device to tenant, build, plan and firmware code version. Composite foreign keys enforce tenant/build/device agreement. One self-flash device per accepted plan is the initial product limit; retries return that identity and never silently replace its credential.

Claim uses a client-generated UUID request ID. It locks current session-family rows and membership, then a tenant/request advisory transaction lock, then the build and device/provisioning rows in a consistent order. It rechecks expiry after waits. The server derives channels from the accepted pinned evidence and approved channel profile, checks the exact passed manifest and generates a random 256-bit device token. `telemetry.devices` stores only its SHA-256 hash.

The configuration handoff stores the token encrypted with AES-256-GCM, a random 96-bit nonce and a configured server key. Additional authenticated data binds tenant, build, plan, device and credential generation. `DEVICE_HANDOFF_KEYS` has an active key ID and a bounded keyring for retiring-key reads; it has no fallback value. Configuration failures name the variable without printing its contents. Device secrets never enter compiled binaries, source bundles, normal status responses, logs or URL parameters.

The handoff lasts ten minutes and is bound to its issuing user and session family. A POST-only attachment download consumes it once and clears encrypted material. Failed/lost download responses require explicit configuration replacement, which rotates the credential and invalidates the earlier file. Replacement uses expected credential version plus a request ID, so double submission cannot rotate twice. The same tenant's authorized operator/admin can explicitly replace a configuration; it does not change device ownership. Revoked identities cannot issue a replacement. Revocation also invalidates an outstanding handoff.

Sequence state is part of recovery: configuration replacement takes the device lock and starts after its highest accepted sequence. The firmware persists pending packet and sequence state before upload, so retries preserve envelope identity. This remains the existing first-party HTTPS Cloudlink protocol and direct PostgreSQL ingestion.

## Firmware handoff contract

`DeviceConfigV1` carries `v`, `device_id`, canonical bearer `token`, trusted `ingest_url`, `seq_start`, `profile_id`, runtime, immutable channel ranges, `build_id`, `plan_version`, `code_version` and `manifest_digest`. HTTPS is required except loopback HTTP in local tests. Query parameters, URL userinfo and fragments are forbidden.

The manifest digest binds exact credential-free manifest bytes to the configuration. The local installer checks those bytes and each artifact hash before flashing. Its separate configuration installation prompts for Wi-Fi locally; Wi-Fi credentials are never sent to the cloud or embedded in shared artifacts. B6 owns validation of the actual partition layout, tool commands and installer. Source edits are not a supported configuration delivery mechanism.

## Validation ledger

Completed foundation checks: authenticated encryption round trips, changed ownership/plan/generation and tampered ciphertext refusal, retiring-key reads, invalid-config secret suppression, canonical token/URL/installer schema checks, and exact active-pin/profile/runtime/firmware/channel-source validation. Test-only approved profile fixtures are explicitly distinguished from the empty production profile list.

The actual migration chain runs on disposable PostgreSQL16. Real-handler tests cover tenant/role/session-family fences, delayed expiry and both revocation orderings, concurrent claim/download/replacement, immutable tenant foreign keys, stale/corrupt/unapproved authority, and secret suppression. The portable C serializer linked into the firmware is compiled and executed on the host; its zero and upper-range envelopes pass actual Cloudlink HTTP and storage, and revoked replay returns401. This executes the serializer, not physical I2C or Wi-Fi.

`apps/web/e2e/device-provisioning.spec.ts` runs production Next and bundled gateway against disposable PostgreSQL with actual authentication and Cloudlink HTTP. It registers through the UI, downloads and deletes the private file, confirms encoder-produced readings, replaces configuration, rejects the old token and revokes the new identity. It checks 1440/390/320 layouts and browser errors. Only accepted plan/profile/compiler authority records are seeded synthetic fixtures; no test marks a real draft part approved. Trace recording is disabled for this secret-bearing journey and downloaded files are deleted rather than attached. Installer/toolchain validation belongs to B6; this B8 journey does not execute physical flashing. Deployment, hardware qualification, eFuse/flash encryption, credential downlink rotation and paid fulfillment are not implied by the software tests.


## API and operating configuration

| Method/path | Scope |
| --- | --- |
| POST `/v1/devices/claim` | Expected tenant, accepted build/plan/code version and request UUID; returns public registration status |
| GET `/v1/devices/:id/provisioning` | Tenant-scoped public status; viewers cannot download |
| POST `/v1/devices/:id/configuration` | Expected tenant/version; private one-use JSON attachment |
| POST `/v1/devices/:id/configuration/replace` | Expected tenant/version plus retry UUID; rotates token and issues a new handoff |
| POST `/v1/devices/:id/credential/revoke` | Expected tenant/version; permanently stops this identity |

The web route `/setup?build=UUID&plan=N&code=N` starts registration. `/setup?device=UUID` shows configuration controls and cloud reception. Browser secret download uses a same-origin POST attachment transport under `/setup/configuration/:id`; no secret enters a Server Action result or React render. All gateway mutations also enforce same-origin admission.

Gateway requires both `DEVICE_HANDOFF_KEYS` (JSON `{ "active": "key-id", "keys": { "key-id": "<canonical 32-byte base64url key>" } }`) and `DEVICE_INGEST_URL` (the standalone HTTPS `/ingest/v1` endpoint) to issue credentials. Neither is required for ordinary telemetry reads or revocation. Keep the keyring in the deployment secret configuration, not source or command logs. Rotate by adding the new key and switching `active`, retaining the previous key until every ten-minute handoff using it expires; retiring a key early makes those downloads unavailable and requires explicit replacement. No Terraform is changed by this track.

The reviewed `registry/provisioning-profiles.json` is bundled in the gateway and currently empty. Local tests alone may set `DEVICE_PROVISIONING_TEST_PROFILES_FILE`; this escape hatch is refused when `K_SERVICE` is set. A profile binds assembly profile/version, runtime, exact part pins and sensor ranges, with explicit host health coverage. Production enablement requires reviewed physical evidence and a code change, not arbitrary browser channel input.

Before reflashing, explicitly replace configuration, download its matching manifest/binaries and run B6's local installer. A lost response consumes the old handoff; refresh and replace rather than expecting another download. An old copied configuration cannot be made safe by local file markers: revoked tokens fail401, conflicting sequences fail409, and the supported recovery is explicit replacement. Revoked identities remain permanently revoked. Existing identities retain their accepted historical plan binding after a new spec is published; new registration requires the current accepted spec.

Reproduce locally (Docker and a C11 compiler required):

```sh
pnpm --filter gateway exec vitest run src/device-provisioning.db.test.ts
pnpm --filter @albusforge/db build
pnpm --filter gateway build
pnpm --filter web build
pnpm --filter web test:browser device-provisioning.spec.ts
```

The browser harness creates ephemeral encryption keys, a local profile file, a local Cloudlink endpoint and disposable database; inherited provisioning/firmware/provider configuration is scrubbed. Optional `enableFirmware` uses a temporary artifact directory and queues PostgreSQL jobs only, with no cloud job dispatch.
