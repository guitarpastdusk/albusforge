# Freenove native camera candidate

This is a separate ESP-IDF 5.5.3 candidate for the verified Freenove ESP32-S3
N16R8 + GC0308 board. Compilation and host tests do **not** establish physical
acceptance. It is outside the accepted-plan worker's production profile allowlist.
The existing N8R8/BH1750 template remains separate.

The camera uses SCCB SDA4/SCL5, XCLK15 at 20 MHz, data
11/9/8/10/12/18/17/16, VSYNC6/HREF7/PCLK13, octal PSRAM at 80 MHz, RGB565
320×240, and manual gain 10. Software JPEG conversion uses quality 80 on the
converter's 0–100 scale. Its owned output buffer is independent of the camera
frame buffer. Capture and local `/snapshot` share a mutex, discard the queued
old frame, and return the camera frame before network I/O. The driver and
converter API are pinned to [esp32-camera 2.1.3](https://github.com/espressif/esp32-camera/tree/v2.1.3).
The committed dependency lock also pins esp_jpeg 1.3.1 and component hashes.

After the first SNTP synchronization, a 0–15 second jitter precedes the first
capture. Further captures use 900-second monotonic deadlines. Slow uploads,
reconnection, and retries do not change capture cadence; missed deadlines are
skipped without a burst. The clock continues locally after synchronization;
each reboot waits for a new synchronization. Capture waits for writable SD.

SDMMC uses CMD38, CLK39, D0 40 in 1-bit mode at probing speed. The runtime never
formats the card. `/albus-observations` contains one fsync'd metadata-plus-JPEG
record per observation, published by rename. Metadata has CRC32 integrity;
the payload SHA256 is checked before upload. After card ownership validation,
startup removes incomplete `.part`
files and rejects corrupted record headers. The queue is bounded by 64 MiB,
672 frames, and seven days. Oldest unsent records are evicted; the active upload
is excluded. Queue limits include record-header bytes.

The root `/albus-observation-owner` marker binds both spool and quarantine to the
exact observation URL, device UUID, capability ID, payload schema and profile
ID/version. It excludes bearer tokens and build identity, allowing credential
rotation and firmware rebuilds for the same destination. One shared marker keeps
the existing 64 MiB queue and separate 8 MiB quarantine limits; identities do not
create additional per-device storage namespaces.

First initialization is allowed only when both directories are absent or empty.
A missing marker beside any existing entry (including legacy `.part` files), a
foreign marker, or a corrupt/truncated marker blocks all record scanning,
capture persistence and upload. Existing media is preserved. `/snapshot` and
Wi-Fi setup remain available; `/health` reports `storage_ready=false` and a
bounded `spool_owner_unbound`, `spool_owner_mismatch`, `spool_owner_corrupt` or
`spool_owner_io` reason. Ownership is revalidated before task I/O and after HTTP
before deletion/quarantine; it is never inferred from a cached ready flag.

Marker creation is exclusive and fsync'd before any record can be stored. A
failed/partial write is not repaired or deleted. ESP-IDF FAT uses file `f_sync`
(including directory entry and device sync); it does not support POSIX directory
fds. Missing/corrupt markers after actual card/controller power loss still fail
closed, but physical durability must be measured. The writable-card probe runs
only after ownership validation and uses an exclusive `.write-check` file; an
existing file is preserved and blocks readiness rather than being overwritten.

To recover a blocked card, preserve a private copy of its marker and both folders.
Restore the original device/destination configuration to resume its owned queue,
or obtain separate approval to reset the preserved spool and marker together.
Deleting only a marker never authorizes adopting legacy media. Do not copy queued
photos into another device's owned folders or publish private card contents.

Capture and upload run in separate tasks. Each pending record keeps the same
UUIDv4, capture time, bytes and SHA256 for every attempt. HTTPS verifies the
certificate bundle, refuses redirects, limits acknowledgment size, matches
observation ID/digest/byte count/state, and deletes only on a matching 200/201
or an authenticated expired response (410). Attempts are at least 10 seconds
apart with bounded exponential backoff, jitter and `Retry-After` support.
401/403 pause uploads for intervention. 400/409/413/415/422 move a bad frame to
`/albus-quarantine`, bounded by 32 records, 8 MiB, and seven days; later frames
continue. Quarantine and normal queue losses are separately counted.

The local `/health` endpoint reports clock/storage readiness, queue count/bytes,
last capture and successful upload timestamps, last HTTP status/error, losses,
and quarantine counts. Health values are synchronized with the spool mutex.
Loss counters are boot-scoped; queue contents are rescanned after reboot.
SD write failure pauses capture until restart with a working card. Local preview
remains available. Physical power-cut, removal, reconnect and sustained capture
tests are still required: host filesystem tests cannot prove FAT/card-controller
power-loss behavior. No claim of SD hardware durability is made here.

## Local setup hotspot

DeviceConfigV2 supplies the device credential and exact cloud endpoint through
private installer configuration. Camera installation defaults to **Plant-A Setup**;
it does not ask for Wi-Fi credentials on the computer. A unique random WPA2
password appears on the physical USB serial console, never in the shared binary,
manifest, repository, or cloud payload. Join the hotspot and open
`http://192.168.4.1`. Captive DNS and common captive-portal probe paths are served.

The AP interface alone accepts setup requests. Noncanonical hostnames redirect
to the literal AP address; POST requires that canonical Host and a matching or
absent Origin to prevent DNS rebinding. A per-session CSRF nonce protects
the bounded form, and credentials are persisted together as one private NVS
value. The hotspot closes on station connection, and returns with a new password
after 60 seconds without Wi-Fi. Credentials stay on the board. `/snapshot` and
`/health` work locally while waiting for Wi-Fi or clock readiness. Wi-Fi uses
WPA2; the portal accepts a 1–32-byte SSID and 8–63-byte password.

## Build and test

From the repository root:

```sh
python3 -m unittest discover -s firmware/tools -p 'test_*.py'
pnpm --filter @albusforge/codegen test
```

The tests compile portable C with warnings treated as errors, exercise actual
files, corrupt/partial records, queue and quarantine count/byte limits, stable
retry policy, deadline skipping, and malformed setup forms. Installer tests bind
the V2 capability identity and device-scoped endpoint to the manifest.

Prepare the pinned managed components once (this requires network access to the
Espressif component registry and creates only ignored build/config files):

```sh
docker run --rm -v "$PWD/firmware/esp32s3-camera:/project" -w /project \
  espressif/idf@sha256:8ccd4d2ce413889c6c2bba57e986c670302094efb91c913c6091152e317a7805 \
  idf.py reconfigure
```

Then create a new review artifact with an explicit local build identity:

```sh
pnpm --filter @albusforge/codegen exec tsx src/compile-camera.ts \
  /private/tmp/albus-camera-review 00000000-0000-4000-8000-000000000000
```

Compilation runs without networking in the pinned IDF image, creates a manifest,
SHA256-bound binaries and installer ZIP, and does not publish, provision or flash.
The fixture identity above is for local compilation; it is not an accepted cloud
build. The generic production firmware worker continues to reject camera plans
until trusted registry/accepted-plan integration and native acceptance are complete.

## Partition and rollback review before flashing

| Region | Offset | Size |
| --- | --- | --- |
| Bootloader | 0x0000 | manifest binary length |
| Partition table | 0x8000 | manifest binary length |
| Private `albus_cfg` NVS | 0x9000 | 0x6000 |
| PHY initialization | 0xf000 | 0x1000 |
| Factory app | 0x10000 | 0x600000 |

The target has 16 MiB flash. There is no OTA partition in this first native
candidate. This layout overwrites ESPHome's partition/configuration layout;
the existing ESPHome Wi-Fi configuration cannot be treated as native NVS.
Before any flash, preserve a **fresh full 16 MiB backup of the currently working
board**, keep it outside version control with restrictive permissions, record its
SHA256, and review the exact new manifest/binaries and private configuration.
The original bring-up backup predates later Wi-Fi provisioning and cannot replace
this fresh backup. Do not log or extract credentials from either image.

Installation writes only the reviewed offsets, at 115200 baud, and provisions
Wi-Fi through the new board hotspot. Restore the fresh full-image backup to roll
back. Do not infer rollback acceptance from compilation; verify local preview,
SD behavior and Wi-Fi after any authorized change. No hardware flash is performed
by the build command or host tests.
