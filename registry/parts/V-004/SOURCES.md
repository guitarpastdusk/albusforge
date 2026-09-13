# V-004 HC-SR04: sources

Module: the classic 5 V HC-SR04. Checked 2026-09-13.

- Datasheet: 5 V supply, 15 mA working current, 2 cm–4 m, 15° angle, 10 µs trigger, 45 × 20 × 15 mm: https://cdn.sparkfun.com/datasheets/Sensors/Proximity/HCSR04.pdf
- Adafruit #3942 (HC-SR04 plus two 10 kΩ resistors to divide the 5 V echo), 5 V only, 15 mA, 45.5 × 20 × 15.5 mm, $3.95: https://www.adafruit.com/product/3942
- SparkFun SEN-15569, 5 V, 15 mA, $5.25: https://www.sparkfun.com/products/15569

No idle figure is published, so `idle` is set to the 15 mA working current. That keeps the power math conservative.

**The echo output is 5 V logic. The ESP32-S3 is 3.3 V and not 5 V tolerant, so the wiring needs a divider or level shifter.** The schema has no field for that yet; see the PR.

Not verified: mounting hole positions (mount is `unspecified`) and operating temperature.

A 3.3 V-capable alternative is Adafruit #4007, the RCWL-1601: 3–5.5 V, 2.2 mA, 2–450 cm, −10…90 °C, $3.95, https://www.adafruit.com/product/4007. It's a different module, so choosing it would be a new definition.
