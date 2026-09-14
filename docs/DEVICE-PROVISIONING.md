# Self-flash device provisioning

Implementation work in progress on `feat/device-provisioning`. This document records the agreed lifecycle and dependency contract; it is not a claim that physical hardware has passed acceptance or that these routes are deployed.

## Authority and supported path

B3 owns accepted persisted build plans. B6 owns credential-free compiled firmware and its artifact manifest. B8 owns registration, the separately encrypted configuration handoff and setup integration. [CLOUD-PLATFORM §4.2](CLOUD-PLATFORM.md) and [ADR 0009](adr/0009-tenant-created-at-sign-up.md) require device ownership to come from the build's tenant. [UI-BACKLOG B3/B6/B8](UI-BACKLOG.md) track these dependencies; [BUILD-TO-DEVICE-DELIVERY.md](BUILD-TO-DEVICE-DELIVERY.md) coordinates the workstreams.

The supported software flow is self-flash. It requires an accepted plan for the build's latest spec, matching immutable registry evidence, a reviewed versioned channel profile and a passed firmware artifact for that exact plan. A server session in the build's tenant with admin or operator role authorizes registration. Viewer, anonymous, expired, revoked and foreign-tenant credentials cannot register or receive a device secret. No request body may supply a tenant, device token, channel ranges or part source snapshot.

The checked-in production provisioning profile list is empty. Current registry parts remain drafts and no hardware acceptance is inferred from software fixtures, successful compilation or a first received packet. Production registration must fail closed until approved evidence exists. Paid fulfillment/checkout is separate; this flow does not invent an order or transfer an arbitrary pre-existing device.

## Proposed storage and lifecycle

Migration 0007 is reserved for B8 after fleet 0005 and accepted-plan 0006. A separate `telemetry.device_provisionings` record links an immutable device to tenant, build, plan and firmware code version. Composite foreign keys should enforce tenant/build/device agreement. One self-flash device per accepted plan is the initial product limit; retries return that identity and never silently replace its credential.

Claim uses a client-generated UUID request ID. It locks current session-family rows and membership, then the build and device/provisioning rows in a consistent order. It rechecks expiry after waits. The server derives channels from the accepted pinned evidence and approved channel profile, checks the exact passed manifest and generates a random 256-bit device token. `telemetry.devices` stores only its SHA-256 hash.

The configuration handoff stores the token encrypted with AES-256-GCM, a random 96-bit nonce and a configured server key. Additional authenticated data binds tenant, build, plan, device and credential generation. `DEVICE_HANDOFF_KEYS` has an active key ID and a bounded keyring for retiring-key reads; it has no fallback value. Configuration failures name the variable without printing its contents. Device secrets never enter compiled binaries, source bundles, normal status responses, logs or URL parameters.

The handoff lasts ten minutes and is bound to its issuing user and session family. A POST-only attachment download consumes it once and clears encrypted material. Failed/lost download responses require explicit configuration replacement, which rotates the credential and invalidates the earlier file. Replacement uses expected credential version plus a request ID, so double submission cannot rotate twice. The same tenant's authorized operator/admin can explicitly replace a configuration; it does not change device ownership. Revoked identities cannot issue a replacement. Revocation also invalidates an outstanding handoff.

Sequence state is part of recovery: configuration replacement takes the device lock and starts after its highest accepted sequence. The firmware persists pending packet and sequence state before upload, so retries preserve envelope identity. This remains the existing first-party HTTPS Cloudlink protocol and direct PostgreSQL ingestion.

## Firmware handoff contract

`DeviceConfigV1` carries `v`, `device_id`, canonical bearer `token`, trusted `ingest_url`, `seq_start`, `profile_id`, runtime, immutable channel ranges, `build_id`, `plan_version`, `code_version` and `manifest_digest`. HTTPS is required except loopback HTTP in local tests. Query parameters, URL userinfo and fragments are forbidden.

The manifest digest binds exact credential-free manifest bytes to the configuration. The local installer checks those bytes and each artifact hash before flashing. Its separate configuration installation prompts for Wi-Fi locally; Wi-Fi credentials are never sent to the cloud or embedded in shared artifacts. B6 owns validation of the actual partition layout, tool commands and installer. Source edits are not a supported configuration delivery mechanism.

## Validation ledger

Completed foundation checks: authenticated encryption round trips, changed ownership/plan/generation and tampered ciphertext refusal, retiring-key reads, invalid-config secret suppression, canonical token/URL/installer schema checks, and exact active-pin/profile/runtime/firmware/channel-source validation. Test-only approved profile fixtures are explicitly distinguished from the empty production profile list.

Pending implementation evidence: migration-chain application; real session/role/revocation/retry concurrency tests; actual accepted-plan-to-registration-to-configuration-to-Cloudlink upload; installer manifest/config rejection probes; production browser setup actions; architecture and rollout documentation updates. Deployment, hardware qualification, eFuse/flash encryption, credential downlink rotation and paid fulfillment are not implied by the software tests.
