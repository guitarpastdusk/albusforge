# E-004 TP4056 charger: sources

Part: TP4056 single-cell Li-ion charger IC, on a module. Checked 2026-09-13.

- NanJing Top Power TP4056 datasheet: https://dlnmh9ip6v2uc.cloudfront.net/datasheets/Prototyping/TP4056.pdf
  - Input: 4.0 V min, 5 V typ, 8.0 V max.
  - Charge voltage: 4.2 V (4.137–4.263 V).
  - Charge current: programmable up to 1000 mA, where I_BAT = (V_PROG / R_PROG) × 1200. R_PROG = 1.2 kΩ gives 1 A.
  - Termination at C/10.

How the numbers map to the part definition:
- `voltage_range` is the input range. `supply.output_v` is the charge voltage window.
- `max_output_ma` is the datasheet maximum. The actual module's R_PROG isn't known yet.
- `current_draw_ma` is 0: the charger is fed from its own USB input, not the assembly's rails.

Not verified:
- **Supplier listing.** Adafruit doesn't sell a TP4056 module, and SparkFun has none. DigiKey results (Soldered Electronics 333013/333014, MikroElektronika MIKROE-4449) all returned 403. So `suppliers` is empty and `unit_cost_usd` is null.
- Module dimensions and input connector, so `bounding_mm` is null and the mount is `unspecified`. Both depend on which module gets picked.
