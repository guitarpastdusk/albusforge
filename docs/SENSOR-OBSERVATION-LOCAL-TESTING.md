# Local mock observation posting

The first backend slice is tested without a camera, cloud credentials, or a GCS
bucket. The HTTP integration suite starts PostgreSQL 16 in Docker, migrates it,
uses the restricted application SQL role, listens on an ephemeral loopback port,
and posts generated 320×240 JPEGs and existing numeric `/ingest/v1` readings.
The image suite keeps its disposable PostgreSQL data in a 256 MiB container
tmpfs to bound disk use during repeated runs.
The object adapter is an in-memory test double; GCS deployment acceptance remains
separate work. No private camera photograph is used.

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter cloudlink test:observations
```

On a Mac using Colima, expose its socket to Testcontainers if runtime discovery
fails (Docker must already be running):

```sh
export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"
export TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock
pnpm --filter cloudlink test:observations
```

To keep exercising mock posting during development:

```sh
pnpm --filter cloudlink test:observations:watch
```

Tests cover a new image and its exact retry, immutable-identity conflicts,
credential revocation, capability disablement, invalid JPEG/hash/time/dimensions,
expired captures, daily quotas and attempt limits, storage failures and recovery,
duplicates across independent service instances,
revocation during upload, aborted requests holding concurrency capacity,
capability-specific presence, and numeric ingestion
while image storage is unavailable. Database and HTTP services are torn down
when the suite completes.

For an already running local Cloudlink instance with observation storage enabled
and a camera capability provisioned by a trusted local fixture, post a synthetic
image twice using a private `{"dev":"UUID","token":"..."}` credential file:

```sh
cd apps/cloudlink
pnpm exec tsx src/simulate-observations.ts /private/tmp/device.json http://127.0.0.1:8080 camera
```

This command accepts only a loopback HTTP origin, refuses redirects, generates
its own image, and expects `201` then `200` with an identical acknowledgment.
It does not provision capabilities, print the token, or accept a remote endpoint.
The automated suite creates its own fixtures and is the self-contained option.

## Implementation status and next steps

This first implementation slice provides C02 shared contracts, C04 additive
schema, C05 object storage and C07 image ingestion foundations. The existing
numeric endpoint shares credential parsing and the total in-flight budget with
images; its wire format, sequence receipts and SQL-only transaction remain intact.
Images have a separate concurrency cap within that total, and durable per-device
minute-attempt and daily count/byte limits. The initial built-in image codec is
`jpeg.v1`; arbitrary payload schemas are not dynamically loaded.

The Cloudlink production entry point intentionally does not supply observation
storage to `buildApp`. Consequently production `/ingest/v2/...` remains disabled;
only the explicit test/local application composition enables it. Applying the
additive migration alone cannot enable camera uploads or approve a camera profile.

Before enabling staging, complete:

1. C03 trusted camera/mixed-device provisioning and private configuration handoff.
2. C06 private GCS bucket/IAM and explicit disabled-by-default runtime settings.
3. C08 lease reconciliation, expiry and durable deletion processing, including
   orphan scans. This slice preserves cleanup intents and recoverable reservations,
   but does not run cleanup. Expired acknowledgments return 410 without promising
   that underlying bytes have already been removed.
4. C11 tenant/capability-authorized read APIs and C12 portal images/status.
5. C13 schema/storage deployment gates, operational limits and real GCS IAM,
   generation and lifecycle acceptance. The storage adapter bounds its object HTTP
   calls; stalled ADC discovery/refresh still needs a total-deadline solution before
   production activation (see `packages/storage/README.md`).
6. C09–C10 native camera driver, 900-second scheduler, durable SD spool and uploader;
   then C14 physical outage/reboot acceptance and the 24-hour soak.

The mock suite exercises real HTTP and real PostgreSQL transactions. Its in-memory
object store and adapter transport tests do not certify deployed GCS behavior,
SD power-loss recovery, board Wi-Fi/TLS, or the 15-minute hardware capture cadence.
