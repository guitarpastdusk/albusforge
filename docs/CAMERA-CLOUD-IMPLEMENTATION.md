# Sensor cloud uploads: shared architecture and camera implementation

Status: proposed, 2026-09-14. Nothing here claims that image upload is deployed.
The required cadence is **one capture every 15 minutes (900 seconds)**. This
expands [the inventory and architecture assessment](CAMERA-CLOUD-PLAN.md).
The camera is the first artifact-producing capability in the shared observation
architecture defined in [SENSOR-OBSERVATION-ARCHITECTURE.md](SENSOR-OBSERVATION-ARCHITECTURE.md).

## Intended behavior and recommended defaults

Only cadence is a user-selected requirement; the following are implementation
recommendations to make the first release concrete and reviewable.

| Concern | Proposed first-release behavior |
| --- | --- |
| Capture | First capture after clock synchronization and a 0–15s initial jitter; then every 900s using monotonic deadlines |
| Camera | Verified Freenove ESP32-S3 N16R8 + GC0308, 320x240 RGB565 converted to JPEG, gain 10 |
| Local preview | Continue supporting local preview; serialize access to the camera and copy/own upload bytes |
| Delivery | Device initiates HTTPS to Cloudlink; independent capture and upload workers |
| Device storage | Dedicated SD spool directory, bounded at 64 MiB, 672 queued captures and 7 days, whichever limit comes first |
| Queue overflow | Delete the oldest unsent capture to admit a newer one, count/report the loss; never silently claim complete history |
| Missing/unwritable SD | Disable scheduled cloud capture and report degraded storage health; local preview still works |
| Clock unavailable | Before first valid sync after boot, wait and report clock-not-ready; do not invent UTC timestamps |
| Offline clock | After synchronization, derive approximate UTC from the monotonic clock during an outage; restart requires synchronization again |
| Historical upload | Accept capture times up to 7 days old and at most 5 minutes ahead; reject inconsistent timestamps |
| Image limits | Raw JPEG body <=1 MiB; dimensions bounded by the approved profile, initially 320x240; bounded decode work |
| Retention | 30 days from capture time in normal viewing; hourly physical cleanup; explicit 7-day GCS soft-delete recovery window |
| Catch-up | At most 6 upload attempts/minute/device; backoff on failure; allow 1,200 new receipts and 128 MiB per UTC receipt day/device initially |
| Identity | Tenant-owned device UUID + revocable random bearer credential; camera capability authorized server-side |
| Cloud UI | Latest picture and paginated history; no cloud live-video streaming in this release |

These queue limits cover seven days at the measured ~14 KB JPEG size, but large
images can reach the byte cap first. Catch-up quotas intentionally exceed the
normal 96 captures/day. A queue limit is a bounded loss policy, not an unlimited
offline guarantee. Quotas and limits must be configuration, observable, and tested.

## Scope and integration decisions

Keep Cloudlink as the device-facing ingestion service and gateway as the
user-facing authorization/read service. Add image routes without changing the
numeric `/ingest/v1` envelope or its receipt semantics. Reuse Cloud Run, HTTPS
edge, Cloud Armor, private Cloud SQL and existing deployment workflows.

The production firmware direction is the native ESP-IDF runtime on the
in-flight `feat/firmware-pipeline` branch. Add the camera as another reviewed
profile; the existing N8R8/BH1750 profile is not compatible with this board and
its GPIO8/9 wiring conflicts with camera data pins. Preserve the working
ESPHome recipe as physical reference evidence. An ESPHome uploader can be a
staging pilot if desired, but does not establish native-runtime acceptance or
become a second production provisioning system by accident.

Coordinate schema/profile contracts with `feat/device-provisioning` and
accepted-plan work before implementing their extension. Recheck branch heads
at implementation time: the inventory is a snapshot, not an instruction to
merge stale branches. The current approved production profile list is empty.
Successful ESPHome bring-up does not automatically approve a native firmware
artifact, all SD operations, or all nominally similar Freenove boards.

## API contract to agree first

Proposed upload:

```http
POST /ingest/v2/devices/{device_uuid}/observations
Authorization: Bearer <device-secret>
Content-Type: image/jpeg
Content-Length: <exact byte length>
X-Observation-Id: <UUIDv4, generated once for this observation>
X-Capability-Id: <provisioned capability identifier>
X-Payload-Schema: jpeg.v1
X-Captured-At: <UTC epoch seconds>
X-Content-SHA256: <64 lowercase hex characters>

<binary JPEG bytes>
```

No base64, multipart body, tenant ID, object key, public URL, or cloud service
account credential is supplied by the device. The server computes the digest
and dimensions rather than trusting supplied metadata. Strictly validate path,
header formats, body size and JPEG structure/decodability. Reject content
encodings in v1 to bound decompression work. A request is one complete frame.

Success is `201` for newly committed storage and `200` for an identical already
committed capture, with a stable acknowledgment:

```json
{"observation_id":"<UUID>","state":"stored","sha256":"<hex>","bytes":14088,"received_at":"<UTC timestamp>"}
```

The firmware removes its pending file only for those statuses with matching
observation ID, digest, size and `state=stored`. The acknowledgment's `received_at`
is the first successful acceptance time and remains stable across retries.
No dynamic cadence change is implied by this acknowledgment.

| Status | Meaning and client action |
| --- | --- |
| 400 / 415 / 422 | Invalid metadata/type/content; quarantine frame, report error and do not loop forever |
| 401 | Unknown, mismatched or revoked credential; pause uploads until reprovisioned |
| 403 | Valid device lacks enabled camera capability; pause and report configuration error |
| 409 | Capture ID reused with different immutable content/metadata; quarantine and surface an identity bug |
| 410 | Previously accepted capture was expired/deleted; discard local replay, do not recreate it |
| 413 | Image exceeds approved size; reject locally on future captures and surface profile error |
| 429 | Retry same capture after Retry-After; do not create a new capture ID |
| 503 / other 5xx / network timeout | Retry exact capture with capped exponential backoff and jitter |

A live in-progress duplicate gets `503` with Retry-After; it is not a content
conflict. Credential revocation is checked even for a historical receipt. After current
authorization and immutable identity verification, resolve stored receipts or
tombstones before applying the seven-day cutoff to new observations. Identical
old retries retain their promised 200/410 behavior; changed identity remains 409.
The new-observation age cutoff must not turn a historical replay into 422.

Proposed gateway routes:

- `GET /v1/devices/:deviceId/capabilities/:capabilityId/images/latest` — newest available capture metadata;
  explicit empty state when the authorized device has none.
- `GET /v1/devices/:deviceId/capabilities/:capabilityId/images?limit=24&cursor=...` — bounded keyset pagination
  on capture time and capture ID; maximum 100 rows, no numeric offset scan.
- `GET /v1/devices/:deviceId/capabilities/:capabilityId/images/:captureId/content` — session-authorized JPEG
  stream. Unknown/foreign device or image is opaque 404; unauthenticated is 401.

Every metadata response includes capability identity. Bind pagination cursors to
the authorized device and capability filter; reject a cursor reused for another
source. Index stored image history on `(device_id, capability_id, captured_at,
observation_id)` and enforce the same capability binding on content reads.

User APIs derive ownership from current session/tenant membership on every
request. Return no bucket name, credential or permanent public object URL.
Content replies use image/jpeg, nosniff and private/no-store initially. Enforce
retention during reads even before asynchronous object deletion completes.

## Storage, consistency and deletion

Use shared observation receipts with typed image metadata. A capture ID is the
observation ID for an image; capability ID distinguishes multiple sensors/cameras
on one device. Add shared schema/migrations through `packages/db`, using its migration generator
and journal conventions. Do not reserve a migration number while concurrent
accepted-plan/provisioning migrations are still landing.

| Record | Required data / constraints |
| --- | --- |
| Device capabilities | Device FK + capability ID, kind/schema version, approved profile/version, enabled flag, per-capability cadence and constraints; this camera interval=900 |
| Observation receipt + typed image metadata | Common unique `(device_id,observation_id)` with capability/kind/schema identity; image metadata FK; content digest, immutable capture time, length and dimensions; reserved/stored/expired/failed state; storage key/generation; first receipt time, expiry time; lease ID/expiry where needed |
| Image usage | Device + UTC receipt month; accepted image count and accepted bytes, incremented once |
| Durable maintenance work | Deletion/reconciliation intent and retry state, retained independently when device/tenant rows are removed |
| Capability presence | Key `(device_id, capability_id)` with last capture and latest successful receipt timestamps, health and configured cadence; retries do not advance presence; device-level presence is an explicit aggregate; fresh image receipt never changes numeric last_seq |

Retain compact receipt/tombstone identity for the device lifetime in v1, matching
the conservative existing numeric receipt policy. Expiring image bytes must not
make old IDs reusable. User/tenant deletion needs a durable object-deletion
record before cascading away SQL ownership rows; otherwise GCS data can orphan.
Do not infer cloud image receipt solely from numeric packet records.

Suggested deterministic object key:
`tenant/<server-derived-tenant>/device/<device>/<capture>.jpg`.

Upload/finalization protocol:

1. Admit within request/concurrency limits; authenticate device and capability
   before accepting expensive work. Receive/decode a strictly bounded frame and
   verify immutable metadata/hash.
2. In a short SQL transaction, recheck credential/capability, lock per capture,
   return a committed duplicate or reserve the fingerprint and quotas with a
   bounded lease. Concurrent quota reservations count toward the daily limits.
3. Release SQL connection. Create the immutable GCS object with generation-match
   zero. On an existing object, verify stored metadata/hash/generation against
   the reservation; never overwrite different bytes.
4. In a second short SQL transaction, check current authorization, matching
   fingerprint and current lease/finalization state. Mark stored, consume the
   reservation, increment usage once, and update image presence. An older
   backfilled capture must not replace the newest capture in latest-image views.
5. Only then return the durable acknowledgment. Lost responses retry into the
   stored receipt. A crash after object creation is recoverable from reservation
   and object metadata, not assumed to be a successful API response.

Maintenance reconciles expired reservations with GCS. It may finalize matching
objects only when the device remains authorized; otherwise tombstone/reject and
schedule deletion. Release abandoned quota reservations exactly once. Fence
late finalizers with state/lease checks. A stale worker may create an object
late, so periodically scan bounded prefixes for orphaned objects as well as SQL
pending rows; use a grace period greater than the upload deadline. Delete with
the recorded generation precondition and recheck row state to avoid deleting a
current committed object. Failure injection must prove these races.

Retention reads use capture-time expiry; the hourly job deletes expired objects
and tombstones their metadata. GCS lifecycle is an asynchronous backstop, not
the exact expiry clock. Configure soft delete explicitly: the proposed 7-day
recovery window means bytes can remain recoverable/billable after logical
expiry. Product deletion policy and customer-facing wording must reflect that.
User-requested deletion must also cover SQL backups/retention policy; do not
promise instantaneous physical erasure from all backups.

## Work packages, dependencies and completion evidence

| ID | Work package and code area | Depends on | Done when |
| --- | --- | --- | --- |
| C01 | Hardware reference: `hardware/freenove/`, registry profile/evidence, pinned versions and secret-free setup | Existing bring-up | Fresh setup reproduces visible JPEG, SD mount and OTA; secrets excluded; profile describes N16R8/GC0308/gain fix |
| C02 | Shared observation/capability/ack/error contracts plus typed measurement/image payloads in `packages/schema` | Architecture agreement | Generic admission and sink interfaces defined; exact fixtures shared by firmware, Cloudlink and gateway; numeric v1 remains compatible |
| C03 | Camera-only registration/profile/config handoff | C01, C02, accepted-plan/provisioning work | Tenant-bound camera device enrolls with separate secret handoff; rotation/revocation and empty numeric-channel cases tested |
| C04 | Shared observation receipts/capability presence and typed image metadata/usage/deletion schema in `packages/db` | C02 | Generated migration/journal, restricted-role grants, indexes and transactional concurrency tests pass |
| C05 | GCS storage adapter shared by Cloudlink/gateway/maintenance | C02 | Create-only write, head/read/delete-by-generation, bounded deadlines and storage-failure tests pass |
| C06 | Private camera buckets, IAM, env/config, job and monitoring Terraform | C02, C04, C05 contracts | Reviewed plans for each environment; separate writer/reader/maintenance permissions; no public access; budgets and lifecycle explicit |
| C07 | Cloudlink observation dispatcher, shared auth/quotas/receipts and JPEG adapter/finalization | C03, C04, C05 | Real HTTP/Postgres tests accept valid JPEG; retries/races/errors preserve one receipt/object/accounting increment |
| C08 | Image reconciliation/expiry/deletion worker and scheduling | C04, C05, C06 | Crash states converge; expired images disappear from reads; orphan/deletion intents handled without unsafe cascades |
| C09 | Native camera driver/profile and 900s capture scheduler | C01, C02, firmware pipeline | Physical capture produces correct JPEGs; preserves gain fix and 16 MiB/PSRAM settings; repeatable native artifact |
| C10 | SD spool, HTTPS uploader, clock/retry/ack handling | C03, C07, C09 | Real board maintains capture cadence through Wi-Fi outage and recovers exact pending captures after reboot |
| C11 | Gateway authenticated latest/history/content APIs and presence/setup projection | C04, C05, C07 | Tenant/role/session changes enforced, history bounded, image-only device confirmed, duplicate/backfill presence correct |
| C12 | Device-view latest photo/history/status UI and usage | C11 | Signed-in user sees stored captures/time/health on desktop/mobile; revoked/empty/expired/error states tested |
| C13 | CI, staging fixtures, schema-ready deploy/promotion gates and operations runbook | C06–C12 | Tests/builds pass; env deployment requires migrations/bucket/IAM readiness; rollback procedure rehearsed |
| C14 | Physical staging acceptance, 24-hour soak and production promotion | C03–C13 | Evidence meets the release checks below; reviewed profiles/configs and immutable image/artifact digests recorded |

C02 also defines the measurement adapter around existing numeric ingest. Its
initial extraction must preserve the existing route and receipt semantics;
adding a numeric v2 codec later is a separate compatibility-tested change.

These IDs are local planning units, not GitHub issues that have been created.
Work can be split among owners after the contracts are fixed. This document does
not spawn agents, assign the active infra role, or authorize concurrent applies.

## Implementation details that should be included in the tickets

### Cloudlink and storage

- Register payload codecs and validators by reviewed kind/schema, behind the
  common observation dispatcher. Register the JPEG parser in an encapsulated
  Fastify plugin so the numeric JSON
  parser/body limit are untouched. Run early auth/admission hooks; byte limits
  must apply to streamed bodies even with absent/false Content-Length.
- Propose image concurrency 4 per instance initially, within the existing
  Cloudlink admission/SQL budget. A 1 MiB request limit is not a total process
  memory bound: budget buffered bodies, decoded pixels, SDK copies and sockets.
- Preserve numeric ingestion transaction behavior through its measurement
  adapter; extract common auth/admission code with regression tests rather
  than duplicating it for images. Add independent short storage/SQL timeouts and an overall request deadline
  below the existing 60s Cloud Run timeout. Cancellation must clean up counters,
  leases and clients; no work after response without durable retry ownership.
- Pin a maintained bounded JPEG decoder/validator and GCS SDK; test their actual
  built-container native/dependency requirements. Do not trust MIME alone or
  run an unbounded decoder in the main event loop.
- Reuse a shared storage adapter rather than making gateway import Cloudlink.
  Device bearer authentication must never authorize user-facing image reads.

### Device runtime

- Add a versioned capability list with per-capability interval (camera=900),
  observation URL, UUID, approved payload schema and limits to
  the versioned device configuration contract. Credentials remain outside
  downloadable generic firmware/source. Device updates obey existing identity
  and credential reissue rules.
- Firmware/native partition layout must be checked against the existing board
  flash before replacing ESPHome. Secure config survives only through an
  explicit installer/migration path; back up before switching firmware families.
- Camera task hands an owned buffer to spool writer; upload task reads the
  completed file. Preview and upload cannot double-return a driver framebuffer.
- Persist bytes and metadata using temporary files plus flush/sync/close and
  rename/commit marker; boot scans validate length/hash and ignore incomplete
  files. FAT power-loss behavior needs physical testing; a rename alone is not
  proof of crash consistency.
- Persist a capture ID once, not per HTTP attempt; keep it independent of the
  numeric telemetry sequence. Validate the matching success acknowledgment.
- Retry with exponential backoff/jitter, bounded by the 6/min attempt cap; honor
  Retry-After. Do not follow redirects to an arbitrary host with Authorization.
  Use the Espressif CA bundle and correct hostname verification; fail closed
  on TLS verification errors. Keep network I/O outside camera callbacks.
- After reboot, recover the queue before beginning new captures. Take a new
  capture on the next configured opportunity, not one for every missed offline
  interval. While running offline with a valid clock, continue capturing until
  the queue policy is reached. At reconnect, drain oldest viable queued frames.
- Expose local last capture/upload, last error, queued count/bytes, dropped count,
  clock sync and SD health. Redact Wi-Fi passwords and bearer tokens from logs.

### Infrastructure and operations

- Proposed buckets: `albusforge-staging-camera-images` and
  `albusforge-prod-camera-images`, subject to global-name availability. Use
  us-central1 Standard storage, uniform bucket-level access and public access
  prevention. Set soft delete and lifecycle explicitly; avoid unplanned versioning.
- Cloudlink SA: create and inspect required objects, no deletion/admin. Gateway
  SA: object read only. Maintenance SA: scoped read/list/delete. Use runtime
  identity/ADC, not a service-account key in firmware or configuration.
- Add `CAMERA_IMAGES_BUCKET`, enable flag, image/body/time limits, quota and
  maintenance batch settings with fail-closed runtime validation when enabled.
  Camera buckets are separate from firmware artifact and Terraform-state buckets.
- Add a maintenance Cloud Run job plus scheduler (proposed hourly). The device's
  15-minute capture timer does not require a cloud scheduler. Job retries/batches
  must fit the existing DB capacity budget and use durable cursors/work markers.
- Add workflow path coverage for new shared code, schema, firmware and infra;
  preserve schema readiness checks and immutable staging-to-prod promotions.
  Main-only deployment restrictions mean feature-branch completion is not deployment.
- Measure successes, failures by bounded reason, duplicates, request/storage
  latency, accepted bytes, oldest pending lease, cleanup backlog, and image gaps.
  Avoid device/tenant IDs as metric labels; correlate through authorized detail
  records and opaque request IDs. Alert on missing images after >35 minutes for
  active enrolled devices, suppressing startup/disabled/revoked devices.
- Forecast storage and operations including GETs, cleanup, soft-delete bytes,
  Cloud Run and existing NAT costs. At the sample size, raw 30-day live images
  are ~40.6 MB/device; that is not total billed storage or an invoice estimate.

## Test and release checklist

### Automated checks

- Schema: malformed UUID/time/hash/headers, unknown fields, correct ack identity,
  JPEG-only type, finite bounds and contract-version compatibility.
- Ingest: missing/revoked/wrong-device credential; disabled camera capability;
  valid 320x240 JPEG; truncated/random/polyglot or oversized content; dimensions
  beyond profile; body-size mismatch; timestamp cutoff; rate/byte quotas.
- Idempotency: simultaneous identical requests, same ID/different metadata or
  bytes, timeout after commit, GCS success/SQL failure, reservation loss, stale
  worker, revocation during upload, retry after expiry, exact usage accounting.
- Storage tests: fake adapter with deterministic injected faults plus separate
  tests against an isolated real staging bucket for generation/IAM/lifecycle
  semantics that mocks/emulators cannot prove. Clean test objects predictably.
- Database: actual PostgreSQL, restricted runtime role, rollback on late failure,
  concurrent quota reservations, latest capture ordering and index/query bounds.
- Reads/UI: anonymous, foreign tenant, revoked session, removed membership,
  workspace switch, retained access to history after upload-credential revocation,
  expired/deleted images, missing object, empty history, paging and browser cache.
- Firmware host tests: scheduler boundary/clock cases, retry classification,
  spool validation/full policy, stable IDs and acknowledgment matching. Real
  hardware tests remain necessary for FAT, camera buffers, Wi-Fi, TLS and resets.
- Multi-camera device: latest/history/content never mix capabilities; cursor
  reuse across capabilities rejects; one healthy camera cannot conceal another
  stale camera in presence/setup projections.
- Numeric telemetry regressions: parser/limits, routes, receipt semantics, usage,
  presence, setup state and existing monitor still behave correctly.

### Physical staging acceptance

1. Enroll one authorized staging camera and install its matching tested artifact
   and private configuration. Confirm existing local camera and SD operation.
2. Store at least five captures spanning >=60 minutes at the configured cadence;
   compare device capture IDs/times, GCS objects, SQL receipts and portal images.
3. Disable Wi-Fi for 45 minutes while the board remains powered; verify queued
   captures and successful bounded drain afterward. Inject a lost acknowledgment.
4. Restart with queued files; inject incomplete file writes, missing/full card and
   transient GCS/SQL failures. Count any intentionally dropped captures explicitly.
5. Revoke the device token, including during an upload. Prove no subsequent
   authorized finalization and no cross-tenant access to stored images.
6. Run a 24-hour steady-state soak: target 96 scheduled captures over a defined
   half-open 24h window after startup, with unique durable receipts, valid visible
   JPEGs, stable heap/queue use and no unexplained resets or losses. Browser
   polling and local preview must not alter the capture/upload cadence.
7. Exercise retention using fixtures/time injection, not a 30-day wait. Verify
   read expiry, physical-delete job, tombstones and the documented recovery window.

### Rollout and rollback

Prepare additive migrations, disabled image config and private infrastructure
first. Follow the existing single-owner Terraform apply process and workflow
exclusion window; the last recorded coordinator is in ARCHITECTURE section
12.3.1 and must be rechecked at rollout time. Deploy schema/storage/maintenance,
Cloudlink and gateway/UI, then enroll/enable the staging device. Promote exact
accepted service images and firmware artifacts after recorded staging evidence.

Rollback disables new image intake/enrollment, pauses firmware uploads through
supported device configuration or restores the known-good firmware, and retains
already stored images/receipts. Roll back services only within additive schema
compatibility; do not destroy buckets or reverse migrations to undo a bad UI or
uploader. Reconcile interrupted uploads before resuming. Device revocation is
an emergency stop, not routine cadence control or an automatic credential reset.

## Suggested PR sequence

### Mapping to infrastructure already in the repository

| Existing code | Reuse / additive change |
| --- | --- |
| `infra/env/main.tf` edge module | Existing `/ingest/*` rule already covers `/ingest/v2/...`; keep gateway `/v1/*` routing. No new domain/LB/NEG is required. |
| `infra/env/sensor.tf` Cloudlink module | Keep service, runtime identity, VPC, DB credentials and instance caps; add disabled-by-default observation upload config and bucket name. Review image-specific admission within the existing numeric/SQL capacity budget. |
| `infra/env/main.tf` gateway module | Keep service and auth architecture; add bucket configuration and bucket-scoped read permission for private artifact responses. |
| `infra/env/sensor-edge.tf` | Preserve existing Authorization/IP Armor controls; evaluate additive observation limits without reducing existing numeric throughput. Durable per-device quotas live in application/DB code. |
| `infra/env/database.tf` and `infra/modules/sql` | Reuse existing PostgreSQL instances and roles. Schema changes belong in `packages/db`, not a new SQL instance or Terraform SQL table definitions. |
| New `infra/env/observation-storage.tf` | Define private camera bucket per environment, explicit lifecycle/soft delete and bucket-scoped IAM. Typed storage configuration can map future artifact kinds to different buckets where policy requires. |
| New `infra/env/observation-maintenance.tf` using `infra/modules/run_job` | Add `observation-maintain` job, its module-created runtime SA, bounded DB pool/storage access, scheduler invocation binding and initially paused hourly schedule. Reuse the scheduler pattern, not numeric maintenance's schema-owner credentials. |
| Existing Secret Manager/module secret mounts | Continue using DB secrets and runtime identity. No GCP key needs to be generated for the board. Provisioning handoff-key deployment is a separate dependency of the in-flight provisioning branch. |
| `infra/env/variables.tf`, `locals.tf`, rollout var-files and outputs | Add explicit per-env activation/limit values, bucket/job outputs and job connection reservations. Include those rollout inputs on every apply. |
| `.github/workflows/deploy-cloudlink.yml` / `promote-cloudlink.yml` | Reuse CI, schema-readiness checks and immutable service image promotion; add config/resource prerequisites and new source-path coverage where needed. |
| Gateway/web deployment workflows | Reuse for capability-aware read API and UI revisions. |
| `deploy-telemetry.yml` / `promote-telemetry.yml` patterns | Supply an explicit observation-job deploy/promotion path or carefully extend job lists, artifact certification and execution checks. Existing workflows do not discover new jobs automatically. |
| Existing metrics/dashboard Terraform | Add upload/finalization/staleness/cleanup signals; preserve existing numeric telemetry alert schedules. |

Concrete rollout order: merge additive contracts/schema/infra with observation
activation disabled; coordinator applies staging infrastructure from merged main
with the staging rollout file; run the matching DB migration; deploy compatible
Cloudlink/gateway and the real maintenance job image; enable its schedule after
readiness; provision and enable one staging camera; test; deploy UI; complete
mixed-sensor and physical acceptance. Repeat schema/infra readiness in production
before promoting the certified image/artifact digests and enabling enrollment.
Production provisioning and the native camera firmware profile are dependencies,
not capabilities supplied merely by creating the bucket.

1. Hardware evidence and shared contract (C01–C02).
2. Image schema and provisioning extension (C03–C04; coordinate dependent branches).
3. Storage adapter, Terraform and maintenance (C05–C06, C08).
4. Cloudlink acceptance and failure tests (C07).
5. Native camera/uploader/spool (C09–C10).
6. Gateway and portal (C11–C12), developed against the shared contract in parallel
   with the uploader once storage semantics are stable.
7. CI/operations and staging acceptance (C13–C14), with test coverage included
   throughout earlier PRs rather than postponed to the final PR.

The smallest useful staging milestone is one authenticated real-board JPEG with
an immutable object, committed receipt and duplicate-safe acknowledgment. The
full release also needs interval/offline behavior, tenant-authorized viewing,
retention/reconciliation and operational acceptance above.

## Primary references

- [Fastify bounded content-type parsers](https://fastify.dev/docs/latest/Reference/ContentTypeParser/)
- [GCS generation preconditions](https://docs.cloud.google.com/storage/docs/request-preconditions)
- [GCS lifecycle behavior](https://docs.cloud.google.com/storage/docs/lifecycle)
- [GCS soft delete](https://docs.cloud.google.com/storage/docs/soft-delete)
- [ESP-IDF HTTPS client and certificate bundle](https://docs.espressif.com/projects/esp-idf/en/v5.5/esp32s3/api-reference/protocols/esp_http_client.html)
