# Sensor observation release status

This checklist records evidence separately from source implementation. A checked
unit/integration test does not certify deployed cloud behavior or hardware.
Capture interval is **900 seconds (15 minutes)**; existing numeric v1 is retained.

| Work | Source and local evidence | Remaining release evidence |
| --- | --- | --- |
| C01 hardware reference | ESP32-S3 N16R8, GC0308, gain 10, pin map and working ESPHome preview recorded; fresh recovery backup verified | Native physical capture, SD writes/recovery, measured registry evidence |
| C02 contracts | Shared capabilities, image metadata, acknowledgment, read and private configuration contracts; existing numeric format preserved | Firmware/cloud interoperability on deployed staging |
| C03 provisioning | Camera-only/mixed private V2 handoff; approved source/manifest/cadence checks; rotation/revocation tests | Activate a reviewed hardware/assembly/provisioning profile through the existing accepted-plan path |
| C04 schema | Migrations 0008/0009, receipts, typed images, independent presence, usage, durable deletion and orphan cursor; migration consistency passes | Deploy matching migration digest to each environment |
| C05 storage | Create-only immutable generations; isolated workers cover ADC and object I/O deadlines; local storage tests | Execute staging-only GCS/IAM acceptance |
| C06 infrastructure | PR79 merged; disabled bucket/IAM/job/schedule definitions; reviewed plans show 17 additions, 2 updates, no deletions per environment | Coordinator applies a fresh plan from merged main |
| C07 ingestion | Real HTTP/PostgreSQL mock photos and numeric readings; replay, conflict, quotas, credential/capability changes, outage recovery | Repeated actual HTTPS staging posts and stored-object checks |
| C08 maintenance | Bounded reconciliation, expiry, durable deletion, generation checks, orphan scans; quota/recovery tests | Deployed job execution, successful heartbeat, schedule and expiry acceptance |
| C09 native capture | Pinned ESP-IDF camera candidate and dedicated native compiler CI; 900-second monotonic schedule | Board image quality and sustained timing evidence |
| C10 queue/uploader | Bounded SD records/quarantine, clock/TLS/retry/ack policies and hotspot; portable filesystem tests | 45-minute Wi-Fi outage, reboot, physical SD/power-loss recovery |
| C11 gateway | Session/tenant-checked private content/history and independent capability status; focused database tests | Deployed browser/session/tenant checks |
| C12 portal | Camera-only/mixed setup, latest/history/source switching and expired-image fallback; 686 web tests pass | Desktop/mobile checks with actual staging captures |
| C13 delivery | Disabled activation flags, schema readiness, worker packaging, maintenance deploy/promotion gates and staging acceptance tools | Green merged source CI, migration/runtime digests and rollback rehearsal |
| C14 rollout | Acceptance procedures and evidence tooling accompany the candidate | Real staging acceptance, 24-hour soak (96 scheduled captures), reviewed production promotion |

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

The native camera candidate is deliberately outside the existing production
firmware worker allowlist. `registry/assembly-profiles.json` and
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
