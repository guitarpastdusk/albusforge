# C-001 ESP32-S3-DevKitC-1: sources

Board: Espressif ESP32-S3-DevKitC-1-N8R8, v1.1. The only brain in MVP (ARCHITECTURE.md §4.1). Checked 2026-09-13.

- **Power in:**
  - Three mutually exclusive supplies: the USB port, the 5V/G pins, or the 3V3/G pins.
  - The USB port is Micro-USB.
  - The 5V pin is fed from USB through Schottky diodes.
  - https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32s3/esp32-s3-devkitc-1/user_guide_v1.1.html
- **Board regulator:** SGM2212-3.3 LDO fed from the 5 V line. https://dl.espressif.com/dl/schematics/SCH_ESP32-S3-DevKitC-1_V1.1_20221130.pdf
- **Board outline:** 62.74 × 25.40 mm, 2.54 mm headers, no mounting holes. https://dl.espressif.com/dl/schematics/esp_idf/DXF_ESP32-S3-DevKitC-1_V1.1_20220429.pdf
- **Chip VDD:** 3.0–3.6 V; the supply should provide at least 0.5 A. ESP32-S3 datasheet v2.2, table 5-2: https://documentation.espressif.com/esp32-s3_datasheet_en.pdf
- **Chip current, same datasheet, tables 5-7 to 5-10:**
  - Deep sleep: 7 µA (RTC memory on).
  - Wi-Fi TX peak: 340 mA (802.11b at 21 dBm).
  - Modem-sleep: 13.2–107.9 mA.
- **Peripherals, same datasheet:** 45 GPIO, 2 × 12-bit SAR ADC (20 channels), 2 I²C, 4 SPI (2 general-purpose), 3 UART, 8 LED PWM channels, Wi-Fi 802.11 b/g/n and Bluetooth 5 LE.
- **Price:** $19.95. https://www.adafruit.com/product/5336

How the numbers map to the part definition:
- `voltage_range` is the chip's VDD at the 3V3 pin. USB and 5V-pin supply go through the board's LDO.
- `current_draw_ma` uses chip figures: deep sleep for idle, Wi-Fi TX peak for active. The board's LDO quiescent current and power LED add draw that isn't published, so battery-life math using `idle` will be optimistic until someone measures the board.
- The capabilities (`bus.*`, `gpio.*`, `net.*`) are what other parts `require`.

Not verified:
- Board height with headers, so `bounding_mm` is null. There are no mounting holes, so the mount is `unspecified` until the fit spike picks a cradle or clip.
- Operating temperature isn't stated for the board.
- DigiKey ESP32-S3-DEVKITC-1-N8R8 wouldn't load (403), so it isn't listed.
