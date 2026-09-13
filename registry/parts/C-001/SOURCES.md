# C-001 ESP32-S3-DevKitC-1: sources

Board: Espressif ESP32-S3-DevKitC-1-N8R8, v1.1. The only brain in MVP (ARCHITECTURE.md §4.1). Checked 2026-09-13.

- **Power in:**
  - Three mutually exclusive supplies: the USB port, the 5V/G pins, or the 3V3/G pins.
  - Both USB ports are Micro-USB.
  - https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32s3/esp32-s3-devkitc-1/user_guide_v1.1.html
- **Power path, from the schematic:**
  - VBUS → 1N5819HW-7-F Schottky (D1, D7) → VCC_5V.
  - VCC_5V feeds the header's 5V pin and the SGM2212-3.3 LDO (U2), whose output is VCC_3V3.
  - LESD5D5.0CT1G TVS diodes sit on VBUS.
  - The CP2102N bridge runs from VCC_3V3 and only senses VBUS through a 22.1 kΩ / 47.5 kΩ divider.
  - https://dl.espressif.com/dl/schematics/SCH_ESP32-S3-DevKitC-1_V1.1_20221130.pdf
- **SGM2212, rev A.2, July 2023:** https://www.sg-micro.com/rect/assets/54089b71-cc25-4f36-af2e-34b07f00a108/SGM2212.pdf
  - Input range 2.7–20 V recommended, 22 V absolute.
  - SGM2212-3.3 output 3.251–3.349 V at 0–800 mA, over −40…125 °C.
  - Dropout at 500 mA: 380 mV max over temperature (240 mV typ); 610 mV max at 800 mA.
- **1N5819HW forward voltage:** at most 0.320 V at 0.1 A and 0.450 V at 1 A. Diodes Inc. DS30217 rev 12-2.
  - The copy read: https://datasheets.b-cdn.net/files/1N5819HW-7-F-Diodes-Inc.-datasheet-7274306.pdf
  - The origin, https://www.diodes.com/assets/Datasheets/1N5819HW1.pdf, returned 403.
- **LESD5D5.0CT1G TVS:** reverse stand-off 5.0 V; breakdown 5.6 V min, 7.8 V max. LRC rev A, May 2025: https://www.lrc.cn/Upload/PDF/Product/ESD/LESD5D5.0CT1G.pdf
- **Board outline:** 62.74 × 25.40 mm, 2.54 mm headers, no mounting holes. https://dl.espressif.com/dl/schematics/esp_idf/DXF_ESP32-S3-DevKitC-1_V1.1_20220429.pdf
- **ESP32-S3 datasheet v2.2:** https://documentation.espressif.com/esp32-s3_datasheet_en.pdf
  - Chip VDD 3.0–3.6 V; the supply should provide at least 0.5 A.
  - Deep sleep 7 µA (RTC memory on); Wi-Fi TX peak 340 mA (802.11b at 21 dBm).
  - GPIO input-high voltage (VIH): 0.75 × VDD to VDD + 0.3 V. IO isn't 5 V tolerant.
  - 45 GPIO, 2 × 12-bit SAR ADC, 2 I²C, 4 SPI (2 general-purpose), 3 UART, 8 LED PWM channels, Wi-Fi 802.11 b/g/n, Bluetooth 5 LE.
- **Price:** $19.95. https://www.adafruit.com/product/5336

## How the numbers map to the part definition

The inputs follow the board's real power path, not the chip's VDD:

| Field | Input | Range | Why |
| --- | --- | --- | --- |
| `voltage_range` | Micro-USB (`connector`) | 4.13–5.5 V | The LDO needs VCC_5V ≥ 3.3 V + 0.38 V dropout (at 500 mA, above the board's 340 mA peak). Add 0.45 V of diode drop. |
| `alt_inputs` `5v-pin` | Header 5V pin, after the diode | 3.68–5.5 V | The same LDO minimum, with no diode. |
| `alt_inputs` `3v3-pin` | Header 3V3 pin, straight to the chip | 3.0–3.6 V | The chip's VDD. |
| `supply.output_v` | VCC_3V3 rail, for peripherals | 3.251–3.349 V | SGM2212-3.3 over load and temperature. `max_output_ma` 800 is the LDO rating, shared with the chip. |

- **Why 5.5 V is the maximum:** the LDO accepts up to 20 V, but VBUS carries TVS diodes that start to break down at 5.6 V. 5.5 V is also the registry's USB connector rating, so both inputs are capped there. A supply above the TVS's 5.0 V stand-off only raises its leakage current.
- **Brown-out below the minimums:** these minimums are where the 3.3 V rail starts to sag, using the dropout's 95 % definition. A Li-ion cell on the 5V pin keeps the board up only down to about 3.68 V at full load; see the fridge monitor's power path in `scripts/golden-builds.ts`.
- **`logic_v` is [3.3, 3.3]:** the IO runs from the 3.3 V rail and accepts at most VDD + 0.3 V. That's why the HC-SR04's 5 V echo is listed in `known-issues.json`.
- **`current_draw_ma` uses chip figures:** deep sleep for idle, Wi-Fi TX peak for active. The LDO's quiescent current (80 µA typ at no load) and the power LED add draw, so battery-life math using `idle` is optimistic until someone measures the board.
- **Capabilities:** `bus.*`, `gpio.*`, `net.*` and `power.3v3` are what other parts `require`.

## Not verified

- Board height with headers, so `bounding_mm` is null. There are no mounting holes, so the mount is `unspecified` until the fit spike picks a cradle or clip.
- Operating temperature isn't stated for the board.
- DigiKey ESP32-S3-DEVKITC-1-N8R8 wouldn't load (403), so it isn't listed.
