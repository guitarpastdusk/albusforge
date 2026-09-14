# Sensor observation release status

This checklist records evidence separately from source implementation. A checked
unit/integration test does not certify deployed cloud behavior or hardware.
Capture interval is **900 seconds (15 minutes)**; existing numeric v1 is retained.

| Work | Source and local evidence | Remaining release evidence |
| --- | --- | --- |
| C01 hardware reference | ESP32-S3 N16R8, GC0308, gain 10, pin map and working ESPHome preview recorded; fresh recovery backup verified | Native physical capture, SD writes/recovery, measured registry evidence |
| C02 contracts | Shared capabilities, image metadata, acknowledgment, read and private configuration contracts; existing numeric format preserved | Firmware/cloud interoperability on deployed staging |
| C03 provisioning | Camera-only/mixed private V2 handoff; approved source/manifest/cadence checks; rotation/revocation tests | Activate a reviewed hardware/assembly/provisioning profile through the existing accepted-plan path |
| C04 schema | Migrations 0008/0009 plus operational health migration 0010; receipts, typed images, independent presence, usage, durable deletion and bounded health/orphan cursors | Staging matching migration passed; production migration remains pending |
| C05 storage | Create-only immutable generations; isolated workers cover ADC and object I/O deadlines; local storage tests | Execute staging-only GCS/IAM acceptance |
| C06 infrastructure | Disabled observation and compiler buckets/IAM/jobs/schedules; upload, lease/backlog, stale-camera and compiler alerts. Historical 17-addition plans predate these additions | Coordinator reviews and applies fresh combined plans from merged main |
| C07 ingestion | Real HTTP/PostgreSQL mock photos and numeric readings; replay, conflict, quotas, credential/capability changes, outage recovery | Repeated actual HTTPS staging posts and stored-object checks |
| C08 maintenance | Bounded reconciliation, expiry, durable deletion, generation checks, orphan scans, health/backlog monitoring; quota/recovery tests | Deployed job execution, successful heartbeat, schedule and expiry acceptance |
| C09 native capture | Pinned ESP-IDF camera candidate, accepted-plan resolver/dispatch and packaged native compiler CI; 900-second monotonic schedule; approval pins default empty | Board image quality and sustained timing evidence |
| C10 queue/uploader | Bounded SD records/quarantine, clock/TLS/retry/ack policies and hotspot; portable filesystem tests | 45-minute Wi-Fi outage, reboot, physical SD/power-loss recovery |
| C11 gateway | Session/tenant-checked private content/history and independent capability status; focused database tests | Deployed browser/session/tenant checks |
| C12 portal | Camera-only/mixed setup, latest/history/source switching and expired-image fallback; 686 web tests pass | Desktop/mobile checks with actual staging captures |
| C13 delivery | Disabled activation flags, schema readiness, worker packaging, observation/compiler deploy and promotion gates, private bench and remote-job staging acceptance tools | Merged source/native/browser CI and staging schema/runtime deployment passed; activation and rollback rehearsal remain |
| C14 rollout | Acceptance procedures and evidence tooling accompany the candidate | Real staging acceptance, 24-hour soak (96 scheduled captures), reviewed production promotion |

## Merged source and disabled staging deployment

PRs [79](https://github.com/guitarpastdusk/albusforge/pull/79),
[80](https://github.com/guitarpastdusk/albusforge/pull/80),
[81](https://github.com/guitarpastdusk/albusforge/pull/81),
[82](https://github.com/guitarpastdusk/albusforge/pull/82) and
[83](https://github.com/guitarpastdusk/albusforge/pull/83) are merged. Source,
browser and pinned native compiler checks passed for merged commit
`bbdaba4ed0e79ca19c79bc188369b21bf8e7be96`. The native compiler result certifies
compilation, not physical camera behavior.

On 2026-09-14, the existing staging deployment workflows completed:

| Component | Verified result |
| --- | --- |
| Schema and registry | `db-migrate-gvqcp` and `registry-load-48vjv` succeeded; matching schema-release gate passed. Shared image `sha256:220e65d8e2c1ba24fd34427bf9026c471832ae0eeab581575074c22da116e18b` |
| Gateway | `gateway-00028-584` serves 100% of traffic; image `sha256:99fe8cc14070969b782516466c525edf227cde34c2efba81ff0f9eb1fe1622d2` |
| Cloudlink | `cloudlink-00003-h54` serves 100% of traffic; image `sha256:2a73d3146f1b9a00a3e48ea981aa2493c3a17801a357b64269732f42f3a87fe9`; startup TCP probe passed |
| Web | Existing staging deployment workflow succeeded |

Deployment evidence: [gateway and schema run](https://github.com/guitarpastdusk/albusforge/actions/runs/34822367184),
[Cloudlink run](https://github.com/guitarpastdusk/albusforge/actions/runs/34823392825),
[web run](https://github.com/guitarpastdusk/albusforge/actions/runs/34822367250).
Observation environment flags remain absent and therefore default to disabled.
The private observations bucket does not yet exist. No Terraform apply,
observation maintenance deployment, real cloud image acceptance, native board
flash, or production promotion is established by these service deployments.
Direct Cloudlink HTTP readiness probes from this Mac are blocked by the existing
load-balancer-only ingress and URL routing; TCP startup and successful schema
release checks are the available evidence, not an HTTP readiness result.

## Follow-up source completion

The private physical bench configuration and cleanup tool is in
[PR85](https://github.com/guitarpastdusk/albusforge/pull/85); the Mac-compatible
remote SQL adapter for real HTTPS mock acceptance is in
[PR86](https://github.com/guitarpastdusk/albusforge/pull/86). Both are plan-only by
default, preserve credentials locally and have scoped recovery procedures.

Operational monitoring is in [PR87](https://github.com/guitarpastdusk/albusforge/pull/87).
The missing compiler infrastructure and accepted-plan camera integration are in
[PR88](https://github.com/guitarpastdusk/albusforge/pull/88) and
[PR89](https://github.com/guitarpastdusk/albusforge/pull/89), respectively.
These source changes do not extend the earlier staging deployment evidence above.
The additional 0010 migration and runtime images require their matching release.
See [compiler infrastructure](FIRMWARE-INFRA.md) for disabled activation,
queue throughput, shared SQL capacity, exact-source compiler certification and
physical approval gates. All infrastructure plans must be regenerated after
merging these changes; the original 17-create/2-update plan is no longer current.

## Ownership and activation

The apply coordinator is the explicit roster in
[ARCHITECTURE §12.3.1](ARCHITECTURE.md#1231-who-applies-terraform). PR79 does not
transfer that role. A request to reassign this session was presented to the user;
no reassignment or cloud apply is inferred from its pending state.

Follow [the infrastructure runbook](SENSOR-OBSERVATION-INFRA.md): apply disabled
resources, migrate, deploy immutable runtime images, execute storage acceptance,
then commit and apply staging activation values. Preserve deployed numeric/Ask
settings. Keep the maintenance schedule paused until its first successful run.
Promote the same image digest only after staging evidence; never rebuild it for
production. Secret files and binary Terraform plans remain local/private.

## Hardware and product enrollment

The accepted-plan worker supports the native camera candidate only when gateway
and worker share explicit reviewed camera approval pins. The deployed approval
list remains empty; source support does not activate a product profile. `registry/assembly-profiles.json` and
`registry/provisioning-profiles.json` contain no active profiles; catalogue parts
are drafts. Compilation and the existing ESPHome bring-up do not establish the
power/mechanical evidence required to activate a product profile. Do not invent
measurements or bypass accepted-plan authorization to make enrollment appear done.
Staging synthetic fixtures can test the upload architecture independently.

Before installing the native candidate, verify its exact manifest/partition
layout and the private configuration handoff. Preserve the fresh 16 MiB recovery
image whose hash is recorded in [the board reference](../hardware/freenove/README.md).
Native Wi-Fi enrollment uses the board's Plant-A Setup hotspot. Native physical
acceptance and the elapsed-time soak remain unperformed until evidence is recorded.
