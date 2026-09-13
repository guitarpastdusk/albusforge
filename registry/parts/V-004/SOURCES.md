# V-004 HC-SR04: sources

Module: the classic 5 V HC-SR04. Checked 2026-09-13.

- **Elecfreaks HC-SR04 datasheet, SparkFun-hosted:** https://cdn.sparkfun.com/datasheets/Sensors/Proximity/HCSR04.pdf
  - Working voltage DC 5 V; working current 15 mA
  - 2 cm–4 m, 15° angle, 10 µs TTL trigger
  - Dimension 45 × 20 × 15 mm
  - The photo shows four straight header pins leaving the board's long edge
- **Adafruit #3942**, HC-SR04 plus two 10 kΩ resistors: 5 V only, 15 mA, "Sensor dimensions (excluding header): 45.5 x 20 x 15.5mm", $3.95. https://www.adafruit.com/product/3942
- **SparkFun SEN-15569:** 5 V, 15 mA, $5.25; no dimensions listed. https://www.sparkfun.com/products/15569
- **ESP32-S3 GPIO VIH maximum** is VDD + 0.3 V, datasheet v2.2: https://documentation.espressif.com/esp32-s3_datasheet_en.pdf

## How the numbers map to the part definition

- **`bounding_mm` is null.** The listed Adafruit module measures 45.5 × 20 × 15.5 mm excluding the header, and the header pins stick out past the 20 mm edge. No source gives their length. Recording the header-less size would undersize the box bodygen packs around, so it stays null until the part is measured with its header, or with the header removed for the mounting the fit spike chooses. 45.5 × 20 × 15.5 mm is the minimum envelope.
- **No idle figure is published,** so `idle` is set to the 15 mA working current. That keeps the power math conservative.
- **`voltage_range` is [5.0, 5.0],** because every source gives only "5 V". Against the Raspberry Pi supply's 5.1 V ± 5 % (up to 5.355 V), the power-path check therefore finds no safe window. That's why HC-SR04 is only `optional` in the presence alert. A published tolerance would resolve it.
- **`logic_v` is [5.0, 5.0].** The echo output is 5 V TTL, and the ESP32-S3 isn't 5 V tolerant. This is recorded in `registry/known-issues.json` with the divider a build needs; that entry also explains why Adafruit's bundled 1:1 divider is marginal.

## Not verified

- Mounting hole positions, so the mount is `unspecified`.
- Operating temperature.

A 3.3 V-capable alternative is Adafruit #4007, the RCWL-1601: 3–5.5 V, 2.2 mA, 2–450 cm, −10…90 °C, $3.95, https://www.adafruit.com/product/4007. It's a different module, so choosing it would be a new definition.
