# Plant A ESP32-S3 handoff

This document records the current physical-device state and the evidence behind
it. It is intended for the next agent working on Plant A. It contains no Wi-Fi,
OTA, bearer-token, photograph, or flash-backup contents.

## Current state

Plant A is a Freenove ESP32-S3 camera board with 16 MiB flash and 8 MiB octal
PSRAM. It runs ESPHome 2026.8.2, built from
[`plant-node.yaml`](plant-node.yaml), and is reachable on its assigned LAN IP
`192.168.1.241`. Its local web dashboard is on port 80, video stream on 8080,
and JPEG snapshot endpoint on 8081.

The board was updated on 2026-09-14 with the reviewed sensor diagnostic
configuration in [PR #93](https://github.com/guitarpastdusk/albusforge/pull/93),
merged as `6f644f2f686ca93567bc2fca3da610882c2e453d`. The upload over USB
completed and verified the written image hash. It preserves the existing private
Wi-Fi and OTA configuration by compiling against the local ignored
`hardware/freenove/secrets.yaml` file; do not copy that file or print its values.

| Item | Observed value |
| --- | --- |
| USB serial device | `/dev/cu.usbmodem5B7A1164331` |
| USB bridge | VID `1a86`, PID `55d3`, serial `5B7A116433` |
| MCU | ESP32-S3 revision 0.2, dual core, 240 MHz |
| Flash / PSRAM | 16 MiB / 8 MiB octal PSRAM |
| Camera | GC0308, PID `0x009b`, QVGA RGB565 with software JPEG conversion |
| Camera live state | dashboard, stream and snapshot endpoints available |
| Firmware image after sensor update | approximately 1.05 MB; 13% of the 8,126,464-byte app partition |

## Recovery material and safety boundaries

Before changing firmware, a full 16 MiB recovery image of the working camera
firmware and provisioned configuration was verified against device MD5. It is
private at
`/private/tmp/albusforge-current-camera-recovery/backups/original-flash.bin`,
mode 0600, with SHA-256
`a3af3ee2d8b186c822635a003cc040edada0544eff98965f60f206801152894d`.

Do not commit, attach, copy, or expose that image. Do not flash at 460800 baud:
past reads were corrupt at that speed; 115200 was reliable. The reviewed serial
flash in PR #93 used the connected USB port and verified its written data.

The shared checkout `/Users/sukritdasgupta/CODE/albusforge` has unrelated local
changes and private hardware files. Do not fast-forward, reset, clean, stash, or
otherwise alter it to work on Plant A. Use a dedicated worktree instead.

## Wiring and observed sensors

The camera SCCB bus is independent from the external sensor bus.

| Bus or component | Pins / address | Evidence |
| --- | --- | --- |
| Camera SCCB | GPIO4 SDA, GPIO5 SCL | Working GC0308 camera configuration |
| External sensor I2C | GPIO47 SDA, GPIO21 SCL | Boot scan after PR #93 found all expected addresses |
| BH1750 light sensor | `0x23` | Driver read live illuminance |
| Soil device | `0x36` | Present in scan only; no measurement driver installed |
| BME280 climate sensor | `0x77` | Driver read live temperature, pressure and humidity |

After the reviewed firmware flash and reset, the serial scan found `0x23`,
`0x36`, and `0x77`. The dashboard then reported these live values:

| Reading | Observed value |
| --- | --- |
| Ambient light | 577.6 lx |
| Air temperature | 25.3 °C |
| Air pressure | 1004.6 hPa |
| Air humidity | 56.3% RH |
| Wi-Fi signal | -58 dBm |

These values establish that the BH1750 and BME280 are communicating. They are
single diagnostic readings, not calibration, environmental accuracy, cloud, or
soak-test evidence.

The `0x36` device must not be represented as a soil-moisture percentage yet.
ESPHome 2026.8.2 does not include a driver for the attached I2C soil sensor.
The registry's current `P-005` definition is the analog DFRobot SEN0193 and is
not interchangeable with this I2C device. Identify the exact `0x36` hardware,
implement or select its protocol driver, and establish dry/wet calibration before
publishing a soil reading or adding it to the cloud device profile.

## Source changes and review evidence

`plant-node.yaml` now declares a second scanned I2C bus and these standard
ESPHome drivers:

```yaml
sensor_i2c: GPIO47 SDA / GPIO21 SCL
BH1750:     address 0x23, 30-second interval
BME280:     address 0x77, 30-second interval
```

Camera pins, camera settings, app partition layout, Wi-Fi behavior, and cloud
flags were not changed by PR #93. The README distinguishes working light/climate
measurements from the scan-only soil device.

Reviewer Codex reviewed exact PR head
`06f7962d3b268dd3705b7d61b9b57e102f80987b` and posted a clean written verdict:
[review comment](https://github.com/guitarpastdusk/albusforge/pull/93#issuecomment-5665212277).
All ten PR checks passed, including the offline camera compiler and packaged
camera compiler checks. Local validation also passed:

```sh
/private/tmp/freenove-bringup-venv/bin/esphome config hardware/freenove/plant-node.yaml
/private/tmp/freenove-bringup-venv/bin/esphome compile hardware/freenove/plant-node.yaml
```

The native ESP-IDF camera candidate and its durable SD spool ownership protection
are separate work in [PR #90](https://github.com/guitarpastdusk/albusforge/pull/90),
merged as `64e1a96c36d125b1c9aa9b046b5133c1140a4f33`. It has not been flashed to
Plant A. The ESPHome build remains the active physical diagnostic firmware.

## Operational observations

The current boot scan shows the external I2C bus recovers successfully. The
camera works after the update and reconnects to the prior Wi-Fi network. The SD
status during the latest boot was `Mount failed: ESP_FAIL`. Do not reformat or
remove the card while diagnosing it. The previous successful mount evidence and
the current failure need to be reconciled with a separate physical-card check.

The web dashboard offers a read-only state stream at `/events`. A safe way to
inspect entity states without saving images is:

```sh
curl --noproxy '*' -sS -N --connect-timeout 3 --max-time 7 \
  http://192.168.1.241/events
```

The USB serial logger is 115200 baud. A reset is sufficient to see the I2C scan;
it does not install firmware. Avoid printing SSIDs, passwords, bearer tokens, or
raw photographs in logs or handoff notes.

## Cloud and enrolment status

The physical sensor discovery does not activate cloud uploads. Staging
infrastructure has a private observations bucket and disabled runtime flags, but
actual observation upload, read access, maintenance scheduling, device handoff
key seeding, and accepted camera/profile activation remain separately controlled
staging gates. The Terraform apply coordinator remains Claude `albusforge-44`.

Do not provision Plant A to the cloud until all of the following are true:

1. The `0x36` soil driver and its calibration are reviewed and evidenced.
2. A reviewed device/assembly profile authorizes the exact hardware and channels.
3. The externally seeded, version-pinned handoff key is available for approved
   provisioning; never add its value to Terraform, source, CI, or logs.
4. Staging ingestion, GCS/IAM, maintenance, and mock image/numeric acceptance
   gates have passed under the coordinator's deployment-window process.
5. Native camera flash and the physical outage/reset/SD/24-hour acceptance are
   separately approved and recorded.

## Suggested next actions

1. Identify the `0x36` soil-sensor board and implement a small, tested driver
   with explicit dry/wet calibration input and bounded read failures.
2. Submit that work as a PR, hand it to Reviewer Codex, and require a written
   exact-head verdict before merge or hardware installation.
3. Flash only the reviewed image, then record the I2C address, raw soil value,
   calibration endpoints, converted percentage, and dashboard state.
4. Resolve the SD mount failure without formatting or writing the card until a
   recovery path is agreed.
5. Keep ESPHome as the physical diagnostic image until cloud and native-firmware
   acceptance gates authorize the next transition.
