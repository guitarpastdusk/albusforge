# V-005 BH1750: sources

Module: Adafruit BH1750, STEMMA QT (#4681). Checked 2026-09-13.

- Size 25.3 × 17.7 × 4.5 mm, price $4.50: https://www.adafruit.com/product/4681
- Module supply 3–5 V (onboard regulator), I²C address 0x23 (0x5C with ADDR high or the jumper): https://learn.adafruit.com/adafruit-bh1750-ambient-light-sensor/pinouts
- Active 0.12 mA typ, power-down 0.01 µA typ, 1–65535 lx, chip range −40…85 °C: ROHM BH1750FVI datasheet, https://www.mouser.com/datasheet/2/348/bh1750fvi-e-186247.pdf (mirror: https://cdn.velleman.eu/downloads/29/infosheets/bh1750fvi-e_datasheet.pdf)

Currents are chip typicals; the regulator's share isn't published.

Not verified: mounting hole size and positions, so the mount is `unspecified`.
