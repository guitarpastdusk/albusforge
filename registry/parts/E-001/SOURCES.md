# E-001 18650 battery: sources

Cell: Adafruit Lithium Ion Cylindrical Battery, 3.7 V 2200 mAh (#1781). Checked 2026-09-13.

- Source for every number below: https://www.adafruit.com/product/1781
  - Nominal cell voltage 3.7–3.9 V; charge cut-off 4.2 V
  - **Discharge cut-off 2.75 V**, the recommended end of discharge
  - **Protection trips at 2.5 V**: "the battery will cut out when completely dead at 2.5V"
  - 2200 mAh
  - 2C peak; keep sustained draw under 0.5C (1 A)
  - Over-voltage, under-voltage and over-current protection
  - 2-pin JST-PH lead
  - 69 mm × Ø18 mm
  - $9.95

The two low-voltage figures mean different things and are kept apart:

- `voltage_range` and `supply.output_v` are **2.5–4.2 V**: everything the terminals can present before the protection circuit disconnects. The power-path check needs that full range so it never assumes the cell stays higher than it can.
- The **2.75 V discharge cut-off** is where firmware should stop drawing and raise `low_battery`, to avoid relying on the protection trip. That threshold belongs to the battery driver and `battery.v1` telemetry, not to the electrical window.

`max_output_ma` is the sustained 1 A figure, not the 2C peak.

A single cell is used rather than a pack: §4.1 says "18650 pack", but a one-cell pack is what fits the fridge monitor. Adafruit #354 (2 × 2200 mAh, 4400 mAh, 69 × 37 × 18 mm, $19.95, https://www.adafruit.com/product/354) could be a second version or part later.
