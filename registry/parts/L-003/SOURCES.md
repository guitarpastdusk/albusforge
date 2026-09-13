# L-003 HC-SR501 PIR: sources

Module: generic HC-SR501. Checked 2026-09-13.

- Supply 5–20 V, "power consumption 65 mA", 3.3 V digital output, 3–7 m range within 120°, −15…70 °C, board 32 × 23 mm, 28 mm hole pitch for M2 screws, Ø23 mm lens: Handsontec user guide, http://www.handsontec.com/dataspecs/SR501%20Motion%20Sensor.pdf
- Static current under 50 µA: SunFounder HC-SR501 sheet (DigiKey-hosted), https://mm.digikey.com/Volume0/opasdata/d220001/medias/docus/8924/ST0012%20%20%20HC-SR501%20Human%20Body%20Pyroelectricity%20Infrared%20Sensor%20Module.pdf

Caveats:
- The two sheets disagree on the supply range: SunFounder says 3.6–30 V. The narrower Handsontec range is used.
- The 65 mA active figure looks high for a BISS0001 design. It's kept because it's the only published number and it errs conservative.

Not verified:
- **Supplier listing.** There's no HC-SR501 listing on Adafruit, SparkFun, DigiKey or Mouser that loaded, so `suppliers` is empty and `unit_cost_usd` is null. Adafruit #189 (https://www.adafruit.com/product/189) is a similar BISS0001 PIR but isn't sold as an HC-SR501, and its specs differ: 5–12 V, 24.03 × 32.34 × 24.66 mm, out of stock at $9.95.
- Height with the lens, so `bounding_mm` is null. Hole positions relative to the board, so the mount is `unspecified`.
