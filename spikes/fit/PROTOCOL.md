# Fit protocol

Run it once per printer in the family (`printers/*.json`). Results from different printers are never
pooled: each printer gets its own tolerances and its own fit rate.

## 0. Record the setup

For every print session, note in `fit-results.csv`: printer id, nozzle, material, slicer, layer height, and
the profile and version from `lint.json` (for example `bambu-a1+generic-fdm-0.4`, `0.0`). Use the same
settings for every print on that printer. Changing them means a new profile version.

Suggested defaults: 0.4 mm nozzle, PLA, 0.2 mm layers, 3 walls, 20% infill, no supports, no brim.

## 1. Coupons (calibrate the printer)

`uv run python -m fit coupons --printer <id>`, then print everything in `out/<id>/coupons/`.
`coupons.json` lists what each coupon varies and which tolerance key the result sets.

Dimples count the step: one dimple is the tightest clearance.

| Coupon | Test | Record |
| --- | --- | --- |
| `hole-plate` + `peg` | Peg into each hole by hand | Tightest hole the peg enters fully without force |
| `slot-block` | The PCB edge (C-001 and E-004) into each slot | Tightest slot the board slides into |
| `port-wall` | A USB-C cable through each opening | Tightest opening the overmold passes. Openings are sized to the spec maximum, so any compliant cable should pass at the same step |
| `gland-wall` | The DS18B20 tube through each hole | Tightest hole the tube passes, and whether it holds |
| `pilot-posts` | Drive an M2.5 self-tapping screw into each post | Smallest pilot hole that doesn't crack the post and still grips |
| `lid-frame` + `lid-c*` | Press each lid on | Tightest lid that closes fully and stays on upside down |

Put the results into that printer's `printers/<id>.json` under `overrides` (top-level tolerance keys; a
nested table like `self_tap_hole_d_mm` is replaced whole). Bump its `version`, and set `calibrated` to
`true` once every coupon result is in. The shared table stays the uncalibrated baseline.

## 2. Enclosures (measure fit)

`uv run python -m fit build layouts/*.json --printer <id>` must pass before printing. Print every body for
each layout (`base.stl`, `lid.stl`, any `hatch-*.stl`), **once**. A reprint is a new trial, never a fix to
the first.

**A layout fits on the first print only if every check passes with no sanding, drilling, glue or force:**

| Check | Pass means |
| --- | --- |
| `seat` | Each part drops into place. Cradle parts are located by their posts; standoff parts sit on all their standoffs |
| `screws` | Every standoff screw goes in straight and grips |
| `ports` | A USB-C cable plugs fully into every port, with the part in place |
| `gland` | The probe passes through and doesn't slide out under its own weight |
| `lid` | The lid closes fully, with no part or wire stopping it |
| `hatch` | Where there is one: it opens by hand at the notch, the cell comes out and goes back, and the hatch stays shut upside down |
| `retention` | With the lid on, shaking the box doesn't dislodge a part enough to unplug a cable |
| `vent` | Slots sit over the BME280 (visible through the lid) |
| `qr` | A phone reads the serial on the inner lid (note lighting or filament tricks needed). Recorded, but not part of `overall` |

Log one row per check per layout in `fit-results.csv`, plus one `overall` row. A layout's `overall` is
`pass` only if every check except `qr` passed.

## 3. The number

**First-print fit rate** = layouts with `overall = pass` ÷ layouts printed, per printer and profile version.

- Print all 9 layouts per printer. Fewer can't tell 90% apart from 70%.
- **≥ 90% on a printer:** the assumption holds for box enclosures with this part set on that printer.
- **The family result** is the worst printer's rate. A generator that fits on three printers and not two
  doesn't meet the bet.
- **Below 90%:** group failures by check. A single check dominating (for example, `ports`) points to one
  missing schema field or tolerance. Failures spread across checks point to the approach. Failures on one
  printer only point to its calibration.

## 4. What goes back into the design

- Tolerance values per printer and material: the tolerance table as a versioned data asset (§7.4).
- `mechanical` fields the generator needed that the schema doesn't have (§18.2).
- The results log columns: the first draft of the fit-feedback data model.
