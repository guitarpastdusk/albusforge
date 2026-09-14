# Staging camera bench fixture

This command prepares a private DeviceConfigV2 for the reviewed native camera candidate and a dedicated staging device. It does not create accepted plans/builds, activate the hardware catalogue, deploy infrastructure, change Cloud Run job configuration, or flash the board. The manifest's build UUID is a local compilation identity. Physical acceptance remains pending until the board and 24-hour evidence satisfy [the acceptance runbook](NATIVE-CAMERA-ACCEPTANCE.md).

The Mac needs authenticated `gcloud` and HTTPS access to Google APIs. The command uses the existing VPC-attached `registry-load` job as `albus_app`, bypassing its registry loader with fixed-purpose Node execution arguments. It verifies the exact staging SQL private IP, database/role/TLS, service account, network/subnetwork and operator-approved immutable image. The Cloud Run v2 [jobs.run etag precondition](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.jobs/run) binds execution to the inspected job version. No new network/IAM resources are required; the operator needs existing read access and `run.jobs.runWithOverrides`.

Start with plan-only; it performs no cloud calls and creates no files:

```sh
pnpm --filter cloudlink exec tsx src/staging-bench-cli.ts \
  --project albusforge-staging --origin https://staging.albusforge.ai
```

After source review, staging deployment checks, and authorization for fixture creation, run the following with a **new absolute directory outside every checkout**, under a private local parent. Do not place it in cloud-synced folders. The values below identify the earlier 0.2 native artifact and the db-jobs image verified on 2026-09-14. They are historical and must not be used with the 0.3 Plant A profile: obtain a newly reviewed artifact digest after its build, rather than hashing arbitrary input and treating that as approval.

```sh
pnpm --filter cloudlink exec tsx src/staging-bench-cli.ts \
  --execute --project albusforge-staging --origin https://staging.albusforge.ai \
  --output /absolute/private-parent/plant-camera-bench \
  --manifest /private/tmp/albus-camera-native-review-final/manifest.json \
  --manifest-sha256 c748468de84d1d7482b3d2dfe59659735c82910f7a48e32a88b39f7366624283 \
  --job-image us-central1-docker.pkg.dev/albusforge-ci/albusforge/db-jobs@sha256:220e65d8e2c1ba24fd34427bf9026c471832ae0eeab581575074c22da116e18b
```

The command creates a mode0700 directory and exclusive mode0600 files. `cleanup.json` is a nonsecret identity journal, fsynced before SQL. `device-config.json` contains a fresh bearer token; only its SHA256 reaches SQL or execution arguments. Never paste, commit, attach, or print the private configuration. `ready.json` appears only after confirmed successful SQL execution. The candidate manifest bytes, profile/runtime/build versions, exact camera capability, four environment channels (light, temperature, pressure and humidity), 320×240 limits, 1MiB maximum and 900-second cadence are bound into the private configuration. The installer separately verifies binary hashes against that manifest. Wi-Fi credentials stay local: native installation defaults to the board setup hotspot. Soil is not part of this fixture.

A failed or interrupted operation may have committed remotely. Preserve the whole directory and run cleanup before preparing another fixture. **Do not install a configuration without `ready.json`, or after cleanup.** Cleanup needs only `cleanup.json`, so it still works if configuration writing or readiness acknowledgement failed:

```sh
pnpm --filter cloudlink exec tsx src/staging-bench-cli.ts \
  --execute --cleanup --project albusforge-staging \
  --origin https://staging.albusforge.ai \
  --output /absolute/private-parent/plant-camera-bench
```

Cleanup locks and verifies the dedicated tenant/device identity, revokes and removes that device, and retains all reserved/stored image deletion intents with a fresh maintenance grace period. It does not synchronously delete cloud objects. The empty named bench tenant remains as a durable fence: even a delayed create job cannot activate a credential after cleanup. This intentionally small retained row also prevents cascading unrelated tenant resources. Cleanup is safe to repeat; SQL remains idempotent even if writing the exclusive local `revoked.json` marker reports that it already exists.

If a regular deployment changes the job image during the soak, cleanup fails closed against the journal's original digest. Supply `--job-image <newly-reviewed-immutable-db-jobs-image>` to approve the new executor for cleanup; the journal's device, tenant, run and manifest binding do not change. Keep the journal until maintenance confirms no pending image intents for its device prefix, then remove local bearer material using the normal private-file retention process.

A successful fixture command is provisioning evidence only. Before separately authorized flashing, recheck the current ESPHome flash backup/digest, reviewed native binaries and partition plan. Follow the acceptance runbook for local preview, actual 900-second capture/upload cadence, 45-minute Wi-Fi outage and recovery, reset during queued upload, missing/reinserted SD card, and 24-hour recorder evidence. Cloud receipt/object verification is independent of local `/health`; a configuration or ready marker does not prove any photograph has reached storage.

Local checks (no cloud writes):

```sh
pnpm --filter cloudlink exec vitest run src/staging-bench.test.ts src/staging-bench.db.test.ts --fileParallelism=false
pnpm --filter cloudlink typecheck
```
