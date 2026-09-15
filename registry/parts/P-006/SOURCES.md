# P-006 Adafruit STEMMA Soil Sensor (#4026): sources

Board: Adafruit STEMMA Soil Sensor, product 4026. A capacitive moisture probe
whose readings are taken by an ATSAMD10 running Adafruit's "seesaw" firmware,
which presents an I²C register interface. Added for the hackathon demo; it is
the sensor the user physically has. Checked 2026-09-14.

## Datasheet / vendor-sourced

- **Product page and guide:** https://www.adafruit.com/product/4026 and
  https://learn.adafruit.com/adafruit-stemma-soil-sensor-i2c-capacitive-moisture-sensor
  - **I²C address 0x36**, changeable to 0x37/0x38/0x39 with two address jumpers.
    This is `electrical.i2c_address`, and the reason `registry/i2c-shared.json`
    stays empty: nothing else in the registry defaults to 0x36.
  - **Connector: JST PH 2.0 mm 4-pin**, Adafruit's *STEMMA* (not STEMMA QT /
    Qwiic, which is JST SH 1.0 mm). This is why the demo needs the new
    `stemma-i2c-ph-4pin-v1` connector rather than reusing `hsx-i2c-4pin-v1`.
    Pin order on the cable is GND, VCC, SDA, SCL.
  - **Supply 3.3 V or 5 V**, with the I²C lines at the supply rail. This is
    `voltage_range` and `logic_v` `[3.0, 5.0]`, matching how P-001 and V-005
    are modelled.
  - The sensor also reports an onboard temperature, which is a rough ambient
    reading, not a soil temperature.
- **seesaw protocol:** https://learn.adafruit.com/adafruit-seesaw-atsamd09-breakout
  - The moisture read is a raw capacitance count, roughly 200 (dry air) to
    2000 (water), not a percentage.

## Estimates — NOT authoritative

| Field | Value used | Basis | What replaces it |
| --- | --- | --- | --- |
| `current_draw_ma` 1.5 idle / 5.0 active | Typical ATSAMD10 + capacitive drive; Adafruit publishes no current figure | Guess | Bench measurement on the 3.3 V rail |
| `bounding_mm` 95 × 15 × 4 | Ruler-class estimate of the PCB blade | Not measured with calipers | Caliper measurement |
| `mount` cable-gland d 5 mm | Sized for the JST PH cable, not the blade | The blade itself is far wider than 5 mm; the gland only has to pass the cable | Decide in the fit spike whether the probe exits through a gland or a slot |
| `environment_flags` temp:0..50C | Assumed indoor plant range | Not a rated range | The ATSAMD10 and PCB ratings, or the vendor's stated range |
| `unit_cost_usd` 7.50 | Typical listed price | Not a checked cart price | A checked vendor listing |
| `exposure` probe-external | The blade goes into soil, so it must leave the enclosure | Reasonable, but the enclosure design is not settled | The fit spike |

## Software and cloud, as declared

- `driver_pkg` **hsx-driver-seesaw-soil** at **0.1.0**, `sdk_module`
  **sensors/soil**. Neither exists yet: the package name is reserved here and
  the driver is being written alongside this change. The compat row asserting
  it compiles (`registry/compat-matrix.json`) is likewise asserted, not
  produced by a compile.
- `telemetry_schema` **soil_moisture.v1**, matching the schema P-005 already
  uses for `read.soil_moisture_pct`.
- **The raw-count to percent conversion is not defined anywhere.** The
  capability is `read.soil_moisture_pct`, so the driver has to map the seesaw
  count to 0–100 %. The end points of that map (dry air, saturated soil) are
  calibration values nobody has taken.

## Not verified

- Whether the two address jumpers are reachable once the probe is in an
  enclosure, which matters for running the user's two units on one bus.
- The onboard temperature reading is deliberately **not** exposed as
  `read.temperature_c`: it measures the board, not the soil, and P-001 already
  provides a real ambient temperature.
