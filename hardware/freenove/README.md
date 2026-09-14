# Freenove camera board bring-up

Hardware identified over USB on 2026-09-13: ESP32-S3 rev 0.2, 16 MiB quad flash,
8 MiB embedded PSRAM. Port: `/dev/cu.usbmodem5B7A1164331`.
The connected USB interface identifies as VID 1a86 / PID 55d3, a serial bridge.

The supplied USB reader exposes a 1.0 GB card as `/dev/disk2`, volume `NO NAME`,
FAT32 with an MBR partition table. On initial inspection it had no user files and
about 1.0 GB free. Device numbers can change on reconnection. Do not reformat it
just to follow the diagram.
There is one card. The board slot was empty during the initial boot, explaining
its SD initialization timeout. After the user inserted the card and reconnected
the board, the SD check successfully mounted it and reported 960 MiB. No file
write test has been performed.

A complete 16 MiB original firmware backup was read and verified against the
device's whole-flash MD5. Its local SHA256 is
`bf948696fa4772f75e248915f496adaee1f2b8f79649fec6f8d8e97bf1cd03c5`.
High-speed reads at 460800 baud produced serial corruption; 115200 worked.

Before native-camera testing, a fresh complete 16 MiB backup of the working
camera and its provisioned configuration was read on 2026-09-14. Every populated
64 KiB block and the whole flash were verified against device MD5; SHA256 is
`a3af3ee2d8b186c822635a003cc040edada0544eff98965f60f206801152894d`.
This recovery image remains private outside the repository. It supersedes the
original pre-provisioning backup for restoring the current working camera.
The board was reset after the read; this operation did not install native firmware.

The separate [native camera candidate](../../firmware/esp32s3-camera/README.md)
implements the 900-second capture/upload runtime. Native physical acceptance is
still required. Neither successful compilation nor the existing ESPHome evidence
approves it for the production accepted-plan catalogue. The catalogue currently
has no active assembly/provisioning profiles; measured power/mechanical evidence
and reviewed profile activation must land before the normal product flow can
issue a production camera build.

This configuration covers the bare-board stage of `bringup_workflow.svg`:
Wi-Fi provisioning, camera, local dashboard, and an additional SD mount/capacity
check. Sensors, servo, cloud ingestion, and a second node require later work.

## Provision Wi-Fi

The final installed build compiled and flashed with verification. Boot logs
confirm a GC0308 camera (PID 0x009b), successful camera initialization, 8192 KB
usable PSRAM, and the setup AP at 192.168.4.1. This sensor requires RGB565 capture
and software JPEG conversion; the configuration uses 320x240, up to 5 fps.
The board joins the provisioned Wi-Fi at 192.168.1.241. Dashboard and snapshot
requests return HTTP 200; serial logs measured streaming at 4.7–4.9 fps. The SD
card mounts at 960 MiB. macOS Local Network permission must be enabled for both
the browser and the terminal app used for diagnostics.

The original camera frames were valid JPEGs but uniformly dark: every pixel was
RGB (23, 28, 24). The GC0308 driver maps ESPHome's default `agc_value: 0` to zero
hardware global gain. Setting `agc_value: 10` fixes this: after a successful OTA
upload, a downloaded 320x240 JPEG (14,088 bytes) showed a clear room image and
decoded successfully. Keep this nonzero gain alongside software JPEG conversion.
Snapshot image files remain temporary/private and are not stored in the repo.
The one-frame UART diagnostic was compiled during investigation but never
installed, and has been removed from the final configuration.

After flashing, join **Plant-A Setup** using `setup_password` from the local
`secrets.yaml`. Open http://192.168.4.1 and enter a 2.4 GHz Wi-Fi network's
credentials. Then reconnect your Mac to that same network.

- Dashboard: http://plant-a.local
- Video: http://plant-a.local:8080/
- JPEG snapshot: http://plant-a.local:8081/

Use the IP printed in serial logs if mDNS does not resolve. A phone hotspot may
isolate clients. A home 2.4 GHz network is another option. For an iPhone hotspot,
enable Maximize Compatibility. Camera endpoints are intended for a trusted LAN;
they do not have HTTP authentication.

The SD status reports whether the existing FAT filesystem mounts and its physical
capacity in MiB. It does not format the card or test file writes. A nominal 1 GB
card can report a smaller number in MiB. If mounting fails, power off before
removing the card, then use the supplied USB reader to inspect it on the Mac.

## Local commands

Tool environment is temporary: `/private/tmp/freenove-bringup-venv` (ESPHome
2026.8.2, Python 3.13). Recreate it if macOS removes temporary files.
Run commands from the repository root. Before validation, copy
`hardware/freenove/secrets.yaml.example` to `hardware/freenove/secrets.yaml` and
replace both placeholders with unique random passwords. Keep that file private.
Use `ls /dev/cu.*` to find the connected board; the port below is this tested
unit and may differ on another Mac. Flashing replaces the installed firmware;
retain a verified recovery backup first:

```sh
python3 -m venv /private/tmp/freenove-bringup-venv
/private/tmp/freenove-bringup-venv/bin/pip install esphome==2026.8.2
/private/tmp/freenove-bringup-venv/bin/esphome config hardware/freenove/plant-node.yaml
/private/tmp/freenove-bringup-venv/bin/esphome compile hardware/freenove/plant-node.yaml
/private/tmp/freenove-bringup-venv/bin/python -m esptool --port /dev/cu.usbmodem5B7A1164331 --baud 115200 write-flash 0 hardware/freenove/.esphome/build/plant-a/build/firmware.factory.bin
/private/tmp/freenove-bringup-venv/bin/esphome logs hardware/freenove/plant-node.yaml --device /dev/cu.usbmodem5B7A1164331
```

`secrets.yaml`, backups, build output, and logs are ignored by Git. Preserve the
OTA password for future wireless uploads. Do not publish flash backups, which
may contain credentials from the previous firmware.

## Corrections and gaps in the supplied workflow

1. Python requirements depend on the ESPHome release; the old “3.10+” statement
   is not a reliable installation constraint. This environment uses Python 3.13.
2. Flash is confirmed as 16 MiB here; do not substitute settings from Freenove's
   older 8 MiB board examples. PSRAM is configured explicitly as octal, 80 MHz.
3. Camera initialization errors also require checking camera pin assignments,
   ribbon seating (with power disconnected), power, and sensor compatibility.
   Flash size alone is not a diagnosis.
4. Keep camera SCCB/I2C on GPIO4/5 separate from later sensor I2C on GPIO47/21.
   An I2C device at 0x36 needs a sensor-specific driver or protocol code;
   `i2c_device` alone does not produce soil-moisture values.
5. A missing sensor in an I2C scan cannot be fixed by changing its configured
   address: first check whether it is actually detected at 0x76 or 0x77.
6. For a separately powered servo, connect grounds together, and avoid tying two
   independent USB 5 V outputs together. Verify servo ratings and available
   supply current. Direction can be corrected in configuration after verifying
   safe mechanical travel. A buzz does not establish that auto-detach is enabled.
7. Dashboard, stream, snapshot, OTA, and cloud POST behavior each require explicit
   configuration. ESPHome installation alone does not implement the cloud stage.
8. The SD card is independent of flash and PSRAM and is unnecessary for live
   streaming. SD logging/image storage would be a separate implementation.

## Sources

- [ESPHome camera configuration and Freenove pin map](https://esphome.io/components/esp32_camera/)
- [ESPHome ESP32 platform](https://esphome.io/components/esp32/)
- [ESPHome PSRAM](https://esphome.io/components/psram/)
- [ESPHome Wi-Fi provisioning](https://esphome.io/components/wifi/)
- [Freenove board pin map](https://docs.freenove.com/projects/fnk0083/en/latest/fnk0083/codes/Python/Preface.html)
- [Freenove SDMMC pin assignments](https://docs.freenove.com/projects/fnk0083/en/latest/fnk0083/codes/C/29_Play_SD_card_music.html)
- [Espressif FAT/SD mounting API](https://docs.espressif.com/projects/esp-idf/en/v5.4.1/esp32s3/api-reference/storage/fatfs.html)
