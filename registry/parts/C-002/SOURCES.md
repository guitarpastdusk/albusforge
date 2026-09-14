# C-002 Freenove ESP32-S3-WROOM CAM (N16R8): sources

Board: Freenove ESP32-S3-WROOM CAM, the N16R8 variant (16 MB flash, 8 MB PSRAM)
with the GC0308 camera module and an onboard microSD slot. Added for the
hackathon demo; it is the board the user physically has and verified.
Checked 2026-09-14.

**Read this first.** Unlike C-001, most of the board-level numbers here are
*estimates*, not datasheet reads. Freenove publishes a tutorial repository and
a board pinout, not a schematic with part numbers for the regulator and
protection devices. Every estimate is repeated in `docs/DEMO-ASSUMPTIONS.md`
with what would replace it.

## Datasheet-sourced (the ESP32-S3 chip itself)

- **ESP32-S3 datasheet v2.2:** https://documentation.espressif.com/esp32-s3_datasheet_en.pdf
  - Chip VDD 3.0–3.6 V; the supply should provide at least 0.5 A.
  - GPIO input-high voltage (VIH): 0.75 × VDD to VDD + 0.3 V. IO is **not** 5 V tolerant.
    This is where `logic_v` `[3.3, 3.3]` comes from, and why the `known-issues.json`
    entry for V-004 against C-002 exists.
  - 45 GPIO, 2 × 12-bit SAR ADC, 2 I²C, 4 SPI, 3 UART, 8 LED PWM channels,
    Wi-Fi 802.11 b/g/n, Bluetooth 5 LE. This is what `software.capabilities`
    asserts: `bus.i2c`, `bus.spi`, `bus.uart`, `gpio.adc`, `gpio.digital`,
    `gpio.pwm`, `net.ble`, `net.wifi`, `power.3v3`.
  - Deep sleep 7 µA with RTC memory on; Wi-Fi TX peak 340 mA (802.11b, 21 dBm).
- **ESP32-S3-WROOM-1 module datasheet:** https://www.espressif.com/sites/default/files/documentation/esp32-s3-wroom-1_wroom-1u_datasheet_en.pdf
  - The N16R8 stock-keeping code is 16 MB quad SPI flash + 8 MB octal SPI PSRAM.

## Vendor material (checked, but not a datasheet)

- **Freenove ESP32-S3-WROOM board tutorial and pinout:**
  https://github.com/Freenove/Freenove_ESP32_S3_WROOM_Board
  - Confirms: two USB-C ports (one to the USB-serial bridge, one native USB),
    onboard camera header carrying the GC0308, microSD slot, 3V3 and 5V header
    pins, and that the board is powered from either USB-C port.
  - This is the source for `connector: "usb-c-v1"` and for the `5v-pin` /
    `3v3-pin` alt inputs.
- **GC0308 camera:** a VGA (640×480) colour sensor on an SCCB (I²C-compatible)
  control bus with a DVP parallel data bus.

## Estimates — NOT authoritative

Each of these is a best guess for the demo. See `docs/DEMO-ASSUMPTIONS.md`.

| Field | Value used | Basis | What replaces it |
| --- | --- | --- | --- |
| `voltage_range` 4.13–5.5 V | Copied from C-001 | Same chip, same class of LDO + Schottky power path; 5.5 V cap matches `usb-c-v1`'s `max_voltage` | Read the actual regulator and protection parts off the board, or a Freenove schematic |
| `alt_inputs` 5v-pin / 3v3-pin | Copied from C-001 | Same reasoning as C-001's SOURCES.md | Same |
| `supply.output_v` 3.2–3.4 V | Generic 3.3 V LDO tolerance (±3 %) | The regulator part number is unknown | Identify the LDO, then use its datasheet window as C-001 does |
| `supply.max_output_ma` 600 | Conservative guess below a typical 800 mA LDO, because the camera and SD card already sit on this rail | Deliberately pessimistic | Measure the rail under camera streaming, or read the LDO rating |
| `current_draw_ma.active` 500 | Chip Wi-Fi TX peak (340 mA, datasheet) plus a guess for camera + PSRAM + SD | Only the 340 mA half is sourced | Bench measurement while streaming over Wi-Fi |
| `current_draw_ma.idle` 0.02 | Chip deep sleep is 7 µA; raised for the camera regulator, the SD card and the power LED, which do not sleep | Only the 7 µA half is sourced | Bench measurement in deep sleep |
| `bounding_mm` 65 × 26 × 14 | Ruler-class estimate of the board with the camera fitted | Not measured with calipers | Caliper measurement, or a vendor mechanical drawing |
| `mount.holes_mm` | Four holes inset 2.5 mm from each corner, 2.2 mm diameter | Plausible for this board class; positions are invented | Measure hole centres from the board corner |
| `unit_cost_usd` 21.95 | Typical street price for the N16R8 kit | Not a checked cart price | A checked vendor listing |
| `commerce.suppliers` DigiKey 1738-FNK0085-ND | Freenove's DigiKey listing for this board family | The exact SKU for the N16R8 + camera bundle was not confirmed | Confirm the SKU on the vendor page |

## Known schema gaps

- **16 MB flash / 8 MB PSRAM cannot be expressed.** `PartDefinition` has no
  memory fields, so the sizes live only in `name` and here. Codegen and the
  firmware partition table need them; today they are carried in
  `firmware/esp32s3-camera/partitions.csv`, not in the registry.
- **The camera is not a capability.** A `read.*` capability must end in a unit
  suffix from `UNIT_SUFFIXES` in `packages/schema/src/units.ts`, and there is no
  image suffix. Adding one means editing `packages/schema`, which this change
  deliberately does not do. So C-002 advertises no camera capability, and the
  matcher cannot select it *for* its camera — only as the brain.
- **The microSD slot is not expressed either**, for the same reason.

## Not verified

- Operating temperature for the board.
- Whether both USB-C ports can safely be powered at once.
- Antenna type and whether the `rf-radiator` flag needs a keep-out distance.
