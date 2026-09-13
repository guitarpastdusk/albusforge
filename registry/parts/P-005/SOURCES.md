# P-005 capacitive soil moisture probe: sources

Module: DFRobot Gravity analog capacitive soil moisture sensor (SEN0193). Checked 2026-09-13.

- Supply 3.3–5.5 V, 5 mA operating, PH2.0-3P connector, analog output: https://media.digikey.com/pdf/data%20sheets/dfrobot%20pdfs/sen0193_web.pdf
- Size 98 × 23 mm, probe tip waterproof, price $5.90 (DFRobot's own store): https://www.dfrobot.com/product-1385.html
- Output range: https://wiki.dfrobot.com/Capacitive_Soil_Moisture_Sensor_SKU_SEN0193

The board has no sleep mode, so idle and active are both 5 mA. The output range is disputed: the datasheet and wiki say 0–3.0 V, while the product page says 1.2–2.5 V. The driver has to calibrate either way.

Not verified:
- **Supplier listing.** DigiKey (403) and Mouser (captcha) wouldn't load, so `suppliers` is empty. The price comes from DFRobot's own store.
- Board thickness, so `bounding_mm` is null. Mounting holes, so the mount is `unspecified`.
- Operating temperature, so there's no temp flag.
- `waterproof` isn't claimed: the datasheet warns that the electronics above the marked line must stay dry.

Alternative with a verified listing: Adafruit STEMMA soil sensor #4026 (I²C, 0x36, 76.2 × 14.0 × 7.0 mm, $7.50, https://www.adafruit.com/product/4026). It's a different interface, so choosing it would be a new definition.
