# Build-to-device delivery: B3, B6 and B8

Implementation authorized September 13, 2026. This ledger tracks the software
path from a validated build plan to firmware and authenticated device telemetry.
It does not declare hardware validation or deployment complete.

## Ownership and delivery branches

| Backlog item | Owner | Branch | Deliverable |
| --- | --- | --- | --- |
| B3 | project/workspace agent (`public_ui`) | `feat/build-plan` | Trusted versioned plan producer, persistence, acceptance API and BOM UI |
| B6 | fleet/telemetry agent (`telemetry_ui`) | `feat/firmware-pipeline` | Supported firmware generation, isolated compilation, artifact APIs and workspace |
| B8 | setup agent (`project_ui`) | `feat/device-provisioning` | Plan-derived registration, secure credential handoff, self-flash setup and upload confirmation |
| Integration and reviews | root | `docs/build-to-device-delivery` | Shared contracts, migration ordering, review routing and combined acceptance |

Each application track uses an isolated worktree and dedicated PR. Branch names
identify assigned work, not completion. Terraform remains owned by the infra
session; application owners supply service, port, environment and storage/job
contracts. No deployment is part of this implementation authorization.

## Existing foundations and missing producers

The matcher implements deterministic feasibility and pinned plan output.
PostgreSQL already has `builds.plans` and `builds.code_bundles`; their existence
does not supply a trusted plan producer, acceptance lifecycle or compiler.
Standalone Cloudlink already authenticates and stores telemetry through direct
PostgreSQL. PR #69 adds read-only setup confirmation for already registered
devices; it does not issue credentials or complete B8 enrollment.

All checked-in registry parts are currently drafts. The matcher documents no
production assembly profiles or passed compiler compatibility entries. Test
fixtures must remain explicitly synthetic. Production planning and provisioning
must not silently promote draft parts or invent wiring, electrical measurements,
physical validation or compatibility results to make the journey pass.

## Shared contract requirements

1. B3 produces plans from server-controlled registry, assembly and compatibility
   inputs, tied to an exact stored specification revision. Acceptance must reject
   stale revisions and enforce current workspace ownership and authorization.
   Candidate matches are distinct from feasible, accepted plans.
2. B6 consumes an identified accepted plan and preserves its exact part/runtime
   versions. Artifacts record their plan and build identity, compiler outcome and
   version. Failed or obsolete output must not appear as ready firmware. Downloads
   enforce tenant ownership; generation and retries have explicit bounds.
3. B8 derives device ownership and channel definitions from that trusted plan.
   Clients cannot choose another tenant or submit arbitrary channel authority.
   Credential issuance and delivery must have defined retry, revocation and
   failure semantics, without secrets in logs or ordinary plan/status responses.
4. Compiler workers must isolate untrusted source and bounded tool execution.
   Per-device credentials require a deliberate injection boundary; a shared
   compiler cache or public firmware artifact must not expose them.
5. Existing strict API responses remain compatible or gain an explicit versioned
   opt-in. Schema migrations are coordinated centrally: migration 0005 is reserved
   for the preceding fleet metadata work; later migrations follow that chain.

## Acceptance sequence

- B3: real PostgreSQL proves scoped plan persistence, stale-spec rejection and
  acceptance behavior; browser tests show BOM, evidence, costs and unavailable
  planning states accurately.
- B6: an actual supported toolchain compiles the generated firmware; negative
  compilation, bounded retry, artifact authorization and stale-plan behavior are
  tested. Synthetic success responses are not compilation evidence.
- B8: real gateway, PostgreSQL and Cloudlink tests cover registration ownership,
  credential retry/revocation and first authenticated upload. Setup states cover
  waiting, partial readings and confirmed receipt.
- Combined software journey: accepted plan -> versioned compiled artifact ->
  securely provisioned device -> authenticated stored reading in the same tenant.
  Synthetic hardware/catalogue inputs must be disclosed in the evidence.
- Physical acceptance: flash the supported board/sensor assembly and observe a
  real reading. This requires actual hardware and reviewed assembly evidence;
  browser tests, compilation and simulated uploads do not clear this gate.

Full B6 also includes instruction-driven edits with a visible diff and successful
compilation before acceptance. Paid checkout provisioning remains tied to real
fulfillment; a self-flash implementation must not imply that checkout exists.
OTA and rollback remain later M8 work.

## Design references

- [UI backlog B3/B6/B8](UI-BACKLOG.md)
- [Matcher contracts and hardware evidence](../apps/matcher/README.md)
- [Cloud provisioning contract, section 4.2](CLOUD-PLATFORM.md#42-authentication--provisioned-at-checkout-not-claimed-after)
- [Tenant ownership ADR 0009](adr/0009-tenant-created-at-sign-up.md)
- [Architecture](ARCHITECTURE.md)
