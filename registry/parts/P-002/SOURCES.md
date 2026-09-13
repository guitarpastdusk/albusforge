# P-002 DS18B20 waterproof probe: sources

Module: Adafruit waterproof DS18B20 (#381). Checked 2026-09-13.

- Supply 3.0–5.5 V. Probe is a 6 mm × 30 mm stainless tube on a 4 mm, 91 cm cable. The PVC jacket limits use to below 100 °C. Not for salt water. Price $9.95: https://www.adafruit.com/product/381
- Standby 750 nA typ, converting 1 mA typ (1.5 mA max), chip range −55…125 °C: https://cdn-shop.adafruit.com/datasheets/DS18B20.pdf

`bounding_mm` is the probe tube, which is what passes through the wall. The gland `d_mm` is the tube diameter; the tolerance table adds clearance. The temperature flag uses the cable's 100 °C limit rather than the chip's 125 °C.
