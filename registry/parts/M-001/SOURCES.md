# M-001 SG90 servo: sources

Part: TowerPro SG90 or equivalent. Checked 2026-09-13.

- 4.8–6 V; stall current under 600 mA; 50 Hz PWM with 1–2 ms pulses; about 180° of travel; 32.0 mm across the tabs; −10…50 °C: https://www.kjell.com/globalassets/mediaassets/701916_87897_datasheet_en.pdf
- 4.8 V nominal; 22.2 × 11.8 × 31 mm body; 10 µs dead band; 0…55 °C: http://www.ee.ic.ac.uk/pcheung/teaching/DE1_EE/stores/sg90_datasheet.pdf
- Up to 200 mA running under load: https://www.auselectronicsdirect.com.au/assets/brochures/TA0132.pdf
- 23.0 × 12.2 × 29.0 mm; 500–2400 µs pulse: https://handsontec.com/dataspecs/motor_fan/SG90-Servo.pdf

How the numbers map to the part definition:
- `current_draw_ma` is the stall current for both idle and active. No idle figure is published, and stall is what sizes the 5 V supply.
- `bounding_mm` is the largest value across the sheets: 32.0 over the tabs, 12.2 wide, 31.0 tall. The horn isn't included.
- The temperature flag is the overlap of the two published ranges.

Not verified:
- **Supplier listing.** No SG90 listing on Adafruit, SparkFun, DigiKey or Mouser was confirmed, so `suppliers` is empty and `unit_cost_usd` is null.
  - Adafruit #169 (https://www.adafruit.com/product/169, $5.95) is a TowerPro SG92R: 3–6 V, 23 × 11 × 29 mm.
  - SparkFun ROB-09065 (https://www.sparkfun.com/products/9065) is a generic sub-micro servo with 29.0 mm tab hole spacing and 2.0 mm holes.
  - Neither is an SG90.
- SG90 tab hole spacing, so the mount is `unspecified`.
