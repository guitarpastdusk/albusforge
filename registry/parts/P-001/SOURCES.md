# P-001 BME280: sources

Module: Adafruit BME280 breakout, STEMMA QT (#2652). Checked 2026-09-13.

- Size 25.2 × 18.0 × 4.6 mm, price $14.95: https://www.adafruit.com/product/2652
- Module supply 3–5 V (onboard regulator), I²C address 0x77 (0x76 with SDO to GND or the ADDR jumper): https://learn.adafruit.com/adafruit-bme280-humidity-barometric-pressure-temperature-sensor-breakout/pinouts
- Current: sleep 0.1 µA typ, pressure measurement 0.714 mA typ (the highest of the per-measurement typicals); operating −40…85 °C. Chip datasheet: https://cdn.sparkfun.com/assets/e/7/3/b/1/BME280_Datasheet.pdf

Currents are chip typicals. The module's regulator adds some draw, which isn't published.

`logic_v` is 3–5 V. From the pinouts page: "All pins going into the breakout have level shifting circuitry to make them 3-5V logic level safe."

Not verified: mounting hole positions, so the mount is `unspecified`. SparkFun SEN-15440 is also a BME280, but its supply range is different (1.71–3.6 V, no regulator), so it isn't listed as a supplier for this definition.

## Version 1.1.0 (hackathon demo, 2026-09-14)

`versions/1.1.0.json` promotes this part to `active`. `part.json` (1.0.0,
draft) is unchanged on purpose: it is already loaded into `registry.parts`,
where a version is immutable.

The only field 1.1.0 changes besides `status` is the mount:

| Field | 1.1.0 value | Basis | What replaces it |
| --- | --- | --- | --- |
| `mount` | `standoffs`, `hole_d_mm` 2.5, four holes at (2.5, 2.5), (2.5, 15.5), (22.7, 2.5), (22.7, 15.5) mm | **Estimate.** Positions are inferred by insetting from the `bounding_mm` 25.2 × 18.0 footprint; the 2.5 mm hole diameter is Adafruit's usual for this breakout size. Nothing here is measured | Caliper measurement of the user's two BME280 boards, or Adafruit's EagleCAD files for #2652 |
