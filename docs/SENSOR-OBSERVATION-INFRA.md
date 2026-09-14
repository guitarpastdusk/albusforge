# Observation infrastructure rollout

The existing Cloudlink, gateway, SQL, load balancer and scheduler identity are
reused. Each environment adds one private Standard GCS bucket, three narrowly
scoped object IAM roles/bindings, one maintenance job with its runtime identity,
an hourly scheduler entry, and maintenance/capacity alerts. No extra ingestion
service, SQL instance, public media endpoint, or device scheduler is required.
The camera retains its own 900-second capture timer.

| Runtime | Object permissions | Configuration |
| --- | --- | --- |
| Cloudlink | create, get (includes metadata/head) | `CAMERA_IMAGES_BUCKET`, `OBSERVATION_UPLOADS_ENABLED=0` initially |
| Gateway | get | `CAMERA_IMAGES_BUCKET`, `OBSERVATION_READS_ENABLED=0` initially |
| observation-maintain | get, list, delete | `OBSERVATION_BUCKET`, limit 100, orphan grace 120 seconds |

All use the isolated storage worker packaged at `/app/storage-worker.cjs`.
Maintenance uses the existing restricted database application role and a single
connection, never the migration owner. Terraform reserves an upper configuration
budget of two connections for this job. Its task timeout is 300 seconds, with
no automatic retries; the application deadline is 240 seconds. The hourly UTC
schedule (`17 * * * *`) starts paused and runs independently of numeric jobs.

SQL expiry is 30 days from capture, and read APIs enforce that deadline before
serving content. The provider's 31-day upload-age lifecycle is a delayed safety
net, not the retention clock. Versioning is disabled; seven-day soft delete is
explicit. Deleted bytes can remain billable for that additional period. Capacity
alert uses [GCS v2 total bytes](https://docs.cloud.google.com/storage/docs/getting-bucket-size)
to include soft-deleted objects. It defaults to 1 GiB, is delayed by provider metric publication, and is not a
billing cap. Review expected device count and billed storage/operations before
activation. A successful maintenance heartbeat must be observed before enabling
the three-hour absence alert; per-item errors do not count as successful health.

## Deployment order and ownership

Only the current [infra/env apply coordinator](ARCHITECTURE.md#1231-who-applies-terraform)
applies these resources, from merged `main`, using the environment's committed
rollout var-file. Preserve existing Ask/telemetry activation settings. This work
does not transfer the coordinator role and has not applied infrastructure.

1. Review merged configuration and fresh plans. Check state locks; coordinate
   workflow drain before service/job shape changes. Apply the disabled flags,
   private bucket/IAM, placeholder job and paused schedule.
2. Deploy the gateway-owned migration image, including observation migrations
   and application-role grants. Require its latest successful matching execution.
3. Dispatch `deploy-observation-maintain` on `main`. It checks successful source
   CI, existing Terraform job and matching schema before publishing an immutable
   image digest, executing the job, and certifying staging success. Promotion
   requires that certification and successful source CI; images are never rebuilt
   for production. Both workflows update images only and never apply Terraform.
4. Run isolated staging GCS/IAM acceptance: create-only conflicts, generation
   reads/deletes, writer deletion denial, reader write/list denial, maintenance
   creation denial, expiry, soft-delete behavior, crash/retry recovery and visible
   successful heartbeat. Use synthetic images and scoped test devices.
5. Deploy Cloudlink/gateway digests with flags still disabled, then have the
   coordinator enable reads/uploads and the reviewed maintenance schedule through
   committed rollout var-files. Verify tenant isolation and mock data/image posts
   before provisioning the physical camera. Preserve the previous service digest
   for rollback; disabling uploads is the first response to unsafe ingest behavior.

## Planning evidence

Read-only plans prepared on 2026-09-14 for both staging and production proposed
**17 creates, 2 updates, 0 destroys**. Updates were limited to Cloudlink/gateway
template environment settings; all activation flags remained off. There was no
unrelated infrastructure drift in those plans. Terraform validation and all 11
mocked tests passed in both workspaces. These are review evidence, not deployment
authorization; regenerate plans after merge and immediately before applying.

Sensitive binary/JSON plans are local only under
`/private/tmp/albusforge-observation-live-plan` (directory 0700, plan files 0600).
They are excluded from version control. Initial private bucket/IAM provisioning,
real staging acceptance and coordinator execution remain external rollout steps.

## Operational image metrics: fresh plan required

The earlier **17 creates / 2 updates / 0 destroys** figures describe the historical disabled infrastructure plan, before the operational upload and health metrics below. They are not approval evidence for this expanded configuration. Generate and review a fresh plan from the merged commit for each environment before any apply; this source change performs no apply.

Cloudlink emits `observation_upload` once per completed response or observed disconnect, with bounded outcome/reason, HTTP status, request/storage milliseconds and response-acknowledged bytes. Cloudlink and the maintenance recovery worker separately emit `observation_accepted` for each confirmed SQL acceptance commit, even when the original client has disconnected. The accepted-bytes distribution exposes confirmed count and byte sum; exact billing/usage must continue to read durable `observation_usage`, because an ambiguous SQL acknowledgement or lost process log can undercount operational events. Duplicate HTTP200 does not emit another accepted event. No metric labels contain device, tenant, observation, object-key, token, URL or request identifiers.

Maintenance emits `observation_health` under its existing advisory lock and restricted SQL client. It reads at most the configured page limit plus one indexed deletion-queue rows and capability rows, and one indexed reserved lease. Backlog count is explicitly a capped lower bound. Ages measure the oldest queued deletion and overdue reserved lease; counters cover the current state after that run's recovery work. PostgreSQL startup bounds remain one connection, a five-second statement timeout and the existing total job deadline.

Camera health uses a durable keyset cursor across all capabilities, joining only the bounded page. Enabled, nonrevoked image capabilities are stale when either their most recent capture or receive timestamp is older than `2 * interval_s + 300` seconds, or no timestamp exists after the same startup grace. Migration/provisioning, re-enable, kind change and cadence change start a durable grace period; an ordinary `enabled=true` update does not restart it. A fresh backfill arrival cannot hide an ancient capture time.

Only a **completed** sweep emits camera enabled/stale totals. Partial pages emit coverage state and scan age but omit fleet totals. Counts describe observations collected across that sweep, not an instantaneous fleet snapshot; a capability changed during the sweep is revisited in the next sweep. At 900-second cadence the stale threshold is 35 minutes, but detection also waits for the hourly schedule and any additional bounded pages. A fleet larger than one page therefore takes multiple hourly runs to cover. `camera_scan_age_s` makes this delay visible in logs and alerts after three hours of sweep age; tune the bounded page size or schedule through a separately reviewed capacity change if the detection window is unacceptable.

Upload rejection alerts enable only with `observation_uploads_enabled`. Maintenance backlog/lease/staleness/failure alerts enable only with `observation_schedule_enabled`; both remain disabled by default. Health thresholds use exact distribution means over the one-hour alignment period, rather than interpolated bucket percentiles. If multiple manual runs contribute samples during that hour, their values are averaged; a nonzero stale sample remains nonzero until it leaves the window. Missing/partial samples do not clear existing health incidents. The separate successful-maintenance heartbeat detects stalled jobs. Before enabling schedules, deploy migration0010 and the matching runtimes, run a verified manual seed sweep, and confirm completed-scan metrics plus recovery behavior. Runbooks must use these fresh checks rather than the earlier infrastructure plan counts.
