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
