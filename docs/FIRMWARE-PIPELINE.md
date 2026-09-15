# Firmware pipeline (B6)

The existing numeric candidate is ESP32-S3-DevKitC-1 N8R8 (`C-001@1.0.0`), USB power (`E-005@1.0.0`) and the BH1750 illuminance sensor (`V-005@1.0.0`), with SDA GPIO8 and SCL GPIO9. The profile is `esp32s3-bh1750-usb-v1@1.0.0`, runtime `0.1.0`. This is software compile support, **not physical validation or production registry approval**. Existing draft registry parts and absent reviewed profiles remain unavailable. Tests explicitly construct synthetic accepted evidence; they do not activate production parts.

The native Freenove N16R8/GC0308 camera candidate is also connected to this pipeline behind an empty-by-default exact evidence approval list. Its capture interval remains 900 seconds. See [camera accepted-plan compiler](CAMERA-ACCEPTED-PLAN-COMPILER.md) and [Terraform/deployment contract](FIRMWARE-INFRA.md).

## Accepted plans and bounded edits

The gateway consumes the persisted, accepted plan for the latest spec, validates its immutable evidence and recomputes the canonical input digest. It requires the exact implemented candidate, active pinned definitions and a passed compatibility tuple. A digest establishes identity, not approval; B3 owns trustworthy acceptance. Migration 0006 and the B3 shared contracts precede this service version.

Numeric `app.cpp` imports only `hsx-sdk.h`; camera source calls the fixed `hsx_camera_run` entrypoint. For the numeric candidate, the supported instruction is `Set interval to N seconds` (10–86400 seconds); an edit cannot shorten the accepted plan's interval, which would invalidate its power assumptions. The UI shows previous and proposed source. Arbitrary C, arbitrary natural-language editing and LLM regeneration are not implemented. Each successful edit creates a new immutable version. This first implementation uses pinned ESP-IDF directly rather than the previously proposed PlatformIO/BullMQ/LLM arrangement.

## API and security

- `GET /v1/builds/:id/code`: current accepted-plan eligibility, permissions and latest 20 versions.
- `POST /v1/builds/:id/code`: idempotent compile request with explicit tenant, plan version and request UUID; optional instruction and passed base version.
- `POST /v1/builds/:id/code/:version/retry`: retry a failed version, up to three worker attempts.
- `GET /v1/builds/:id/code/:version/files/:file`: verified attachment, including `firmware.zip`, manifest, generated source and the three flash binaries.

Reads permit current workspace members, including viewers. Mutations require admin/operator, same-origin admission and the page's expected tenant. Managed database leases fence late queries. Writes lock session ancestry and membership before the build; publication locks the build before the code row and rechecks acceptance in a fresh statement after waiting. Revoked sessions, stale workspaces and foreign builds are rejected. Responses and downloads are private/no-store. Artifacts contain no device credential or Wi-Fi information.

One active compile and at most 100 versions are admitted per build. The UI displays only its returned version window; it does not imply an unlimited history. A durable PostgreSQL row queues work; dispatch failure leaves it pending for a later worker invocation. Workers claim with `SKIP LOCKED` after acquiring a global session advisory lock. One dedicated connection retains ownership throughout compilation, and publication uses that same connection plus a unique row lease. Losing the session cancels compilation and prevents publication. Contending workers exit without claiming. Running leases expire after 15 minutes. Three exhausted attempts become failed. Older accepted plans cannot publish after a newer spec is committed. Archived successful artifacts remain downloadable, but provisioning must require the currently accepted plan.

## Compiler, storage and infrastructure contract

`apps/codegen` is a dedicated `fwbuild` job, separate from gateway and Cloudlink. The pinned image is `espressif/idf@sha256:8ccd4d2ce413889c6c2bba57e986c670302094efb91c913c6091152e317a7805` (ESP-IDF 5.5.3). Local Docker compilation disables networking and caps CPU, memory and process count. Production runs the same installed toolchain inside the dedicated job. Only a bounded generated SDK call is accepted; this is not a general-purpose sandbox for user-supplied source. Child environments exclude database and cloud credentials.

Infra owns Terraform and deployment. Required job contract: one task, 2 vCPU, 4 GiB memory, task timeout at most 900 seconds; direct private PostgreSQL with a pool of two connections; no HTTP listener. Compile deadline is 600 seconds. Cloud Run exposes `CLOUD_RUN_JOB` for jobs, distinct from service `K_SERVICE`; either environment requires durable bucket storage. [Cloud Run container contract](https://docs.cloud.google.com/run/docs/container-contract).

Worker environment: existing database variables, `FIRMWARE_ARTIFACT_BUCKET`, `FIRMWARE_COMPILER_MODE=idf`, `FIRMWARE_TEMPLATE_DIR=/app/firmware/esp32s3`, `FIRMWARE_CAMERA_TEMPLATE_DIR=/app/firmware/esp32s3-camera`, and `CAMERA_PLAN_APPROVALS=[]` until approved activation. Gateway receives the same bucket and approval array, `FIRMWARE_JOB_RESOURCE=projects/PROJECT/locations/REGION/jobs/fwbuild`, and `FIRMWARE_DISPATCH_MODE=scheduler`. Grant gateway object-read only; the scheduler identity receives job-execution permission. The deployed gateway queues work without per-request execution. Grant worker immutable object-create plus restricted database access. Configure job egress to private PostgreSQL and required Google APIs. Gateway never invokes a local compiler. For explicit local tests only, use `FIRMWARE_ARTIFACT_DIR` and gateway `FIRMWARE_JOBS_ENABLED=1`; do not configure both bucket and directory. A scheduled job invocation must drain queued work and recover abandoned leases; one invocation handles one row. The reviewed deployment uses a quarter-hour schedule, one task, zero retries and an 840-second timeout. Reserve admission overlap in the database budget; the advisory lock controls active compilation rather than providing a hard global execution count. No Terraform, scheduler, IAM or deployment is applied by this change.

Artifacts use unique build/version/lease object keys and create-only writes. Downloads recompute SHA-256 against the stored manifest or bundle record before returning bytes. The ZIP has deterministic entry timestamps and contains exact canonical manifest bytes, three binaries, generated source, installer and pinned Python requirements. The installer hashes those exact bytes; it never reserializes cross-language JSON to infer identity. ESP-IDF reproducible-build configuration is enabled. Binary and ZIP equality are checked by the optional repeated-compile acceptance test.

## Device installation and runtime

B8 provides the separate authorized, one-time configuration download. The firmware page links to `/setup?build=UUID&plan=N&code=N`. Download `firmware.zip` and the matching fresh configuration, then:

```sh
unzip firmware.zip -d firmware-bundle
python3 -m venv firmware-tools
firmware-tools/bin/pip install -r firmware-bundle/requirements.txt
firmware-tools/bin/python firmware-bundle/install.py --bundle firmware-bundle --config device-config.json --port /dev/ttyUSB0
```

The installer verifies artifact hashes and build/plan/code/profile/runtime/channel identity before flashing. Wi-Fi SSID and password are prompted locally and never sent to the cloud. It generates the `albus_cfg` NVS partition at `0x9000` (size `0x6000`); bootloader is at `0`, partition table at `0x8000`, application at `0x10000`. Python tools are pinned to `esp-idf-nvs-partition-gen==0.1.9` and `esptool==4.11.0`. [Espressif NVS generator](https://docs.espressif.com/projects/esp-idf/en/v5.5.3/esp32s3/api-reference/storage/nvs_partition_gen.html), [partition tables](https://docs.espressif.com/projects/esp-idf/en/v5.5.3/esp32s3/api-guides/partition-tables.html).

After **any flash attempt**, obtain an explicit fresh cloud configuration reissue before reflashing. It rotates the credential and obtains a current sequence start. The local used-file marker is a best-effort guard, not a security boundary against copied configuration files. The installer does not silently request or rotate cloud secrets. Configuration is stored in device NVS; encrypted flash/secure boot and physical credential extraction resistance are not implemented.

Runtime validates the compiled build/plan/code identity, connects using WPA2 Wi-Fi and synchronizes its clock before sending HTTPS with the ESP-IDF CA bundle. It reads real BH1750 measurements; sensor failures do not fabricate readings. A single NVS value durably binds the next sequence and pending packet before transmission. Lost acknowledgments or restarts replay that same packet; a 202 clears it. Permanent authorization/contract failures stop uploads. There is one pending packet, not a historical offline queue; new measurements pause while retrying. Sampling uses the compiled interval; dynamic cloud interval control is not implemented. No battery data is invented. [BH1750 board pinouts](https://learn.adafruit.com/adafruit-bh1750-ambient-light-sensor/pinouts), [ESP-IDF HTTPS client](https://docs.espressif.com/projects/esp-idf/en/v5.5.3/esp32s3/api-reference/protocols/esp_http_client.html).

## Verification and remaining acceptance

Real PostgreSQL tests cover tenant/role/origin admission, duplicate concurrent requests, worker claim/lease fencing, expiry/retry limits, immutable downloads and both spec-change/publication lock orderings. The optional `FIRMWARE_REAL_COMPILER=1` gateway test compiles an accepted synthetic fixture using the real pinned toolchain and downloads its verified ZIP; `FIRMWARE_REPRO_CHECK=1` compiles identical input twice and compares exact manifests and ZIPs. Portable C encoder tests execute the same encoder linked into the ESP binary. B8 separately exercises that encoder's output against real Cloudlink HTTP ingestion.

The production Next/Chrome journey covers queueing, refresh, version status, download, bounded edit/diff and viewer refusal at 320 and 1440 px; its compiler is explicitly a synthetic fixture. Installer tests verify artifact/config mismatches and unsafe input; NVS generation is exercised without flashing. No physical board has been flashed or measured. Hardware-in-loop wiring, sensor accuracy, network interruption/reboot recovery and production profile approval remain required external acceptance before offering this candidate as production-compatible.
