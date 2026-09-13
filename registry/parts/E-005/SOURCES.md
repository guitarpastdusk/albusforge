# E-005 USB-C 5 V supply: sources

Supply: official Raspberry Pi 15 W USB-C power supply (US model KSA-15E-051300HU), sold by Adafruit as #4298. Checked 2026-09-13.

- Product brief, the source for:
  - Output: +5.1 V at 3.0 A, ±5 % load regulation.
  - Input: 100–240 Vac.
  - Captive 1.5 m 18 AWG USB-C cable.
  - Body: 45 × 45 × 27 mm.
  - https://pip-assets.raspberrypi.com/categories/501-raspberry-pi-15w-usb-c-power-supply/documents/RP-008244-DS-1-15w-usb-c-power-supply-product-brief.pdf
- Adafruit #4298: $8.74, out of stock when checked. https://www.adafruit.com/product/4298

`voltage_range` and `supply.output_v` are 5.1 V ± 5 %. The mains side is a certified adapter outside the enclosure (`mount: external`); the platform itself stays low-voltage DC (ARCHITECTURE.md §9).

Not verified: the DigiKey and Mouser SC0218 listings didn't load (403 and timeout).
