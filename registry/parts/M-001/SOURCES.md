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
- The control input's logic threshold, so `logic_v` is null. Hobby servos are often driven from 3.3 V PWM, but no SG90 sheet says so. The logic-level check skips this part until one does, and the schema rejects null once the part is past draft.

## Version 1.1.0 (hackathon demo, 2026-09-14) — estimates, NOT authoritative

`versions/1.1.0.json` promotes this part to `active` so the demo build can pin
it. `part.json` (1.0.0, draft) is unchanged on purpose: that version is already
loaded into `registry.parts`, where a version is immutable. Every value added
for 1.1.0 is a guess. See `docs/DEMO-ASSUMPTIONS.md`.

| Field | 1.1.0 value | Basis | What replaces it |
| --- | --- | --- | --- |
| `electrical.logic_v` | `[3.0, 5.5]` | **Estimate.** No SG90 sheet states a control-input threshold. 3.0 V is the low end at which the common AA51880/equivalent servo IC is reported to latch a pulse; 5.5 V is the supply cap. Chosen so the 3.3 V hosts fall inside it and the validator's logic-level check passes | Scope the signal pin against a 3.3 V PWM source on the user's actual servos, or a genuine SG90 control-circuit datasheet |
| `mount` | `tabs`, `hole_d_mm` 2.2, `hole_spacing_mm` 27.8 | **Estimate.** SparkFun's generic sub-micro servo gives 29.0 mm spacing with 2.0 mm holes; 27.8 / 2.2 is the commonly cited SG90 figure, unverified | Caliper measurement of the user's four servos |
| `commerce.suppliers` | Adafruit #169 | **Substitute.** As the 1.0.0 notes say, #169 is a TowerPro SG92R, not an SG90. It is listed so the part can leave draft | A confirmed SG90 listing, or renaming this part to the SG92R |
| `commerce.unit_cost_usd` | 5.95 | The Adafruit #169 price, i.e. the substitute's price | The price of whatever the supplier row finally names |

`logic_v` being non-null is load-bearing: `apps/matcher/src/constraints.ts`
rejects any non-host, non-power part whose `logic_v` does not contain the
brain's IO voltage, and the schema rejects null past draft.
