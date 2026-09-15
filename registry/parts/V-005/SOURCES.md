# V-005 BH1750: sources

Module: Adafruit BH1750, STEMMA QT (#4681). Checked 2026-09-13.

- Size 25.3 × 17.7 × 4.5 mm, price $4.50: https://www.adafruit.com/product/4681
- Module supply 3–5 V (onboard regulator), I²C address 0x23 (0x5C with ADDR high or the jumper): https://learn.adafruit.com/adafruit-bh1750-ambient-light-sensor/pinouts
- Active 0.12 mA typ, power-down 0.01 µA typ, 1–65535 lx, chip range −40…85 °C: ROHM BH1750FVI datasheet, https://www.mouser.com/datasheet/2/348/bh1750fvi-e-186247.pdf (mirror: https://cdn.velleman.eu/downloads/29/infosheets/bh1750fvi-e_datasheet.pdf)

Currents are chip typicals; the regulator's share isn't published.

`logic_v` is 3–5 V. From the pinouts page, SCL and SDA are each "level shifted so you can use 3-5V logic".

Not verified: mounting hole size and positions, so the mount is `unspecified`.

## Version 1.1.0 (hackathon demo, 2026-09-14)

`versions/1.1.0.json` promotes this part to `active`. `part.json` (1.0.0,
draft) is unchanged on purpose: it is already loaded into `registry.parts`,
where a version is immutable.

The only field 1.1.0 changes besides `status` is the mount:

| Field | 1.1.0 value | Basis | What replaces it |
| --- | --- | --- | --- |
| `mount` | `standoffs`, `hole_d_mm` 2.5, four holes at (2.5, 2.5), (2.5, 15.2), (22.8, 2.5), (22.8, 15.2) mm | **Estimate.** Positions are inferred by insetting from the `bounding_mm` 25.3 × 17.7 footprint; the 2.5 mm hole diameter is Adafruit's usual for this breakout size. Nothing here is measured | Caliper measurement of the user's two BH1750 boards, or Adafruit's EagleCAD files for #4681 |
