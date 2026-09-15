# registry/

**The menu** ([`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) §3). Every part the platform can put in a build is a Part Definition here, and no service hard-codes knowledge of a specific part (§1.1). This directory is data. The only code is the validator and the catalogue builder.

| Path | What it is |
| --- | --- |
| `parts/<ID>/part.json` | One Part Definition (§4), validated by `PartDefinition` in [`packages/schema/src/part.ts`](../packages/schema/src/part.ts) |
| `parts/<ID>/versions/<semver>.json` | Another version of the same part. `part.json` is the base version; a version already loaded into `registry.parts` is immutable, so promoting a part means adding a file here, never editing the loaded one |
| `parts/<ID>/SOURCES.md` | Where each number came from (datasheets, product pages), and what couldn't be verified |
| `parts/<ID>/footprint.step` | The part's footprint for bodygen, shared by every version of the part. Six are **placeholder stubs** for the demo; see [`docs/DEMO-ASSUMPTIONS.md`](../docs/DEMO-ASSUMPTIONS.md) |
| `connectors/<id>.json` | Connector standards the parts name in `electrical.connector` |
| `schemas/*.schema.json` | JSON Schema **generated** from the zod schemas; don't hand-edit |
| `i2c-shared.json` | Parts that deliberately share a default I²C address, with a note on why that's safe |
| `compat-matrix.json` | Driver / runtime / brain compile results seeded into `registry.compat_matrix` by `scripts/load.ts`. **Hand-maintained for the demo**; ARCHITECTURE.md §22 has a CI matrix job generating these |
| `known-issues.json` | Cross-part problems accepted for now (today: logic-level mismatches), each saying what a build must do |
| `scripts/validate.ts` | Checks the whole registry; exits 1 with a list of problems |
| `scripts/catalogue.ts` | `buildCatalogue` / `renderCatalogue`: the compact, deterministic catalogue intake caches in its prompt prefix ([`ASK-TO-ENCLOSURE.md`](../docs/ASK-TO-ENCLOSURE.md) §3) |
| `scripts/golden-builds.ts` | Capabilities and intended power path for the three golden builds (§4.1) |
| `scripts/lib/power.ts` | `checkPowerPath`: finds a voltage-compatible way to power a golden build |
| `scripts/schemas.ts` | Regenerates `schemas/`; with `--check`, fails when they're stale |

## The twelve MVP parts (§4.1)

| Id | Part | Provides |
| --- | --- | --- |
| P-001 | BME280 | `read.temperature_c`, `read.humidity_pct`, `read.pressure_hpa` |
| P-002 | DS18B20 waterproof probe | `read.temperature_c` |
| P-004 | MPU-6050 | `read.acceleration_g`, `read.angular_rate_dps` |
| P-005 | Capacitive soil moisture probe | `read.soil_moisture_pct` |
| V-004 | HC-SR04 | `read.distance_cm` |
| V-005 | BH1750 | `read.illuminance_lux` |
| L-003 | HC-SR501 PIR | `read.motion_bool` |
| C-001 | ESP32-S3-DevKitC-1, the only brain | `bus.i2c`, `bus.spi`, `bus.uart`, `gpio.digital`, `gpio.adc`, `gpio.pwm`, `net.wifi`, `net.ble`, `power.3v3` |
| M-001 | SG90 servo | `act.position_deg` |
| E-001 | 18650 cell | `power.battery` |
| E-004 | TP4056 charger | `power.charge` |
| E-005 | USB-C 5 V supply | `power.5v` |

## The demo build's parts (added 2026-09-14)

| Id@version | Part | Provides |
| --- | --- | --- |
| C-002@1.0.0 | Freenove ESP32-S3-WROOM CAM (N16R8), the demo brain | `bus.i2c`, `bus.spi`, `bus.uart`, `gpio.digital`, `gpio.adc`, `gpio.pwm`, `net.wifi`, `net.ble`, `power.3v3` |
| P-006@1.0.0 | Adafruit STEMMA soil sensor #4026 | `read.soil_moisture_pct` |

Six parts are `active` so a build can pin them: `C-002@1.0.0`, `P-006@1.0.0`,
`P-001@1.1.0`, `V-005@1.1.0`, `M-001@1.1.0`, `E-005@1.1.0`. The four `1.1.0`
versions sit in `versions/` beside untouched `1.0.0` drafts that are already
loaded into `registry.parts`. Many of their values are estimates; every one is
tracked in [`docs/DEMO-ASSUMPTIONS.md`](../docs/DEMO-ASSUMPTIONS.md).

## Draft until the footprint exists

`validate.ts` requires `mechanical.footprint_file` to exist for any `active` or `deprecated` part (§7.5). Real footprints arrive with the fit spike, so **every part not in the demo build is still `draft`**. Each `footprint_file` already names the path the file will have.

A draft may leave unset whatever couldn't be verified, and each part's `SOURCES.md` lists the gaps:

- `bounding_mm` and the mount
- suppliers and `unit_cost_usd`
- `logic_v` for a signal part

To promote a part to `active`:

1. Commit a real `parts/<ID>/footprint.step`. Never a placeholder.
2. Fill in `bounding_mm`, a measured `mount`, at least one checked supplier and a price.
3. Make sure a signal part has `logic_v`, and a sensor or actuator has a driver, `sdk_module`, `telemetry_schema` and a default widget.
4. Set `"status": "active"` and run `pnpm --filter @albusforge/registry validate`.

The schema and validator reject a non-draft part that's missing any of these. The host and passive power parts are the one exception: they may have no driver or channel.

The catalogue builder offers only `active` parts by default. Until parts are promoted, intake gets an empty menu unless it asks for drafts. That's intentional.

## Electrical model

- **`voltage_range`** is what the part accepts at its `connector`, including whatever the board puts in front of the chip. For C-001 that's the USB input after its protection diode and regulator, not the chip's 3.0–3.6 V VDD.
- **`alt_inputs`** lists other rails the part can be powered from instead, such as C-001's `5v-pin` and `3v3-pin`.
- **`supply`** is what a part feeds the assembly: an energy part's output, or the host's regulated rail.
- **`logic_v`** is the IO voltage window a part's signal lines work with. The host declares the single voltage it drives. Every live peripheral's window must include every host's IO voltage, or the mismatch must be recorded in `known-issues.json`. The HC-SR04's 5 V echo is recorded there today.
- **Golden-build power paths:** `scripts/golden-builds.ts` names each build's supply and the brain input it's wired to. The validator checks that path is voltage-compatible:
  - The supply never exceeds the input's maximum, and their windows overlap.
  - Peripherals requiring `power.5v` run from the supply; the rest run from the brain's rail.

  Connector fit and current budget are still the matcher's job (§7.2).

## Vocabulary

- **Capabilities** are `<namespace>.<name>`.
  - Sensors provide `read.*` and actuators `act.*`, each ending in a unit suffix from `scripts/lib/units.ts` (`_c` is °C, `_pct` is %, and so on).
  - The brain and energy parts provide `bus.*`, `gpio.*`, `net.*` and `power.*`, which other parts list in `electrical.requires`.
  - Every `requires` entry must be provided by a draft or active part.
- **Environment flags** are the fixed list in `KNOWN_ENVIRONMENT_FLAGS`, plus `temp:<min>..<max>C`.
- **Cloud:** widgets and alert templates need a `telemetry_schema`. `low_battery` needs `power.battery`, and `out_of_range` needs a numeric `read.*`.
- **I²C:** two live parts with the same `i2c_address` fail validation unless `i2c-shared.json` has an entry for them.
- **Currents** are typicals from the datasheet unless `SOURCES.md` says otherwise. Where no idle figure is published, idle is set equal to active so power math errs conservative.
- **Changing a part:** a published `(id, version)` is immutable (§4). Bump the semver for any change, and use `deprecated` plus `successor` to retire a part in favour of another. Versions, including pre-releases, are ordered by SemVer §11.

## Commands

```sh
pnpm --filter @albusforge/registry validate   # also runs as this package's lint task
pnpm --filter @albusforge/registry schemas    # regenerate schemas/ after editing packages/schema
pnpm --filter @albusforge/registry test
```

Loading the registry into Postgres (`scripts/load.ts`, §5) comes with the gateway work, not here.
