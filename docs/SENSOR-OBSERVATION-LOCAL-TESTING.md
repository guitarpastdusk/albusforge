# Local mock observation posting

The observation backend is tested without a camera, cloud credentials, or a GCS
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

## Runtime validation and rollout

The runtime implements trusted camera/mixed-device configuration handoff,
capability-specific presence, authenticated private image reads/history, portal
views, and bounded maintenance reconciliation/deletion. Numeric v1 retains its
wire format and SQL-only transaction. The initial image codec is `jpeg.v1`;
arbitrary payload schemas are not dynamically loaded.

Cloudlink enables object storage only with `OBSERVATION_UPLOADS_ENABLED=1`;
gateway reads require `OBSERVATION_READS_ENABLED=1`. Both require a bucket and a
readable packaged storage worker. Defaults and committed initial infrastructure
flags remain disabled. Storage operations run in terminable isolated workers so
credential discovery/refresh is covered by the total deadline too.

Run the focused backend suites with Docker available:

```sh
pnpm --filter cloudlink test --fileParallelism=false
pnpm --filter gateway test --fileParallelism=false
pnpm --filter observation-maintain test --fileParallelism=false
pnpm --filter @albusforge/storage test
pnpm --filter web test
```

The gateway suite covers image-only and mixed provisioning, rotation/revocation,
tenant/session isolation, expired images and independent capability health.
Maintenance tests cover leased reservations, missing objects, exact retries,
retention, durable deletion and paginated orphan scans. Storage tests exercise
worker admission and deadlines as well as immutable generations. The staging GCS
acceptance command and least-privilege checks are documented in
[`packages/storage/README.md`](../packages/storage/README.md).

Deployment order and coordinator ownership are in
[SENSOR-OBSERVATION-INFRA.md](SENSOR-OBSERVATION-INFRA.md). Migrations and source
builds alone do not approve a hardware profile or enable uploads. Real GCS/IAM
acceptance, native board outage/reboot tests and the 24-hour 15-minute-cadence soak
remain release gates. Mock HTTP/PostgreSQL and object transport tests do not
certify deployed cloud behavior or SD power-loss recovery.
