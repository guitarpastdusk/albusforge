# registry/

**The menu** ([`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) §3). Every part the platform can put in a build is a Part Definition here, and no service hard-codes knowledge of a specific part (§1.1). This directory is data. The only code is the validator and the catalogue builder.

| Path | What it is |
| --- | --- |
| `parts/<ID>/part.json` | One Part Definition (§4), validated by `PartDefinition` in [`packages/schema/src/part.ts`](../packages/schema/src/part.ts) |
| `parts/<ID>/SOURCES.md` | Where each number came from (datasheets, product pages), and what couldn't be verified |
| `parts/<ID>/footprint.step` | The part's footprint for bodygen. **Not committed yet** (see below) |
| `connectors/<id>.json` | Connector standards the parts name in `electrical.connector` |
| `schemas/*.schema.json` | JSON Schema **generated** from the zod schemas; don't hand-edit |
| `i2c-shared.json` | Parts that deliberately share a default I²C address, with a note on why that's safe |
| `scripts/validate.ts` | Checks the whole registry; exits 1 with a list of problems |
| `scripts/catalogue.ts` | `buildCatalogue` / `renderCatalogue`: the compact, deterministic catalogue intake caches in its prompt prefix ([`ASK-TO-ENCLOSURE.md`](../docs/ASK-TO-ENCLOSURE.md) §3) |
| `scripts/golden-builds.ts` | Capabilities the three golden builds need (§4.1) |
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
| C-001 | ESP32-S3-DevKitC-1, the only brain | `bus.i2c`, `bus.spi`, `bus.uart`, `gpio.digital`, `gpio.adc`, `gpio.pwm`, `net.wifi`, `net.ble` |
| M-001 | SG90 servo | `act.position_deg` |
| E-001 | 18650 cell | `power.battery` |
| E-004 | TP4056 charger | `power.charge` |
| E-005 | USB-C 5 V supply | `power.5v` |

## Draft until the footprint exists

`validate.ts` requires `mechanical.footprint_file` to exist for any `active` or `deprecated` part (§7.5). Footprints arrive with the fit spike, so **all twelve parts are `draft`**. Each `footprint_file` already names the path the file will have.

Drafts may also leave `bounding_mm`, the mount, suppliers and `unit_cost_usd` unset where no source could be verified. Each part's `SOURCES.md` lists the gaps.

To promote a part to `active`:

1. Commit a real `parts/<ID>/footprint.step`. Never a placeholder.
2. Fill in `bounding_mm`, a measured `mount`, at least one checked supplier and a price.
3. Set `"status": "active"` and run `pnpm --filter @albusforge/registry validate`.

The schema and validator reject an `active` part that's missing any of these.

The catalogue builder offers only `active` parts by default. Until parts are promoted, intake gets an empty menu unless it asks for drafts. That's intentional.

## Vocabulary

- **Capabilities** are `<namespace>.<name>`.
  - Sensors provide `read.*` and actuators `act.*`, each ending in a unit suffix from `scripts/lib/units.ts` (`_c` is °C, `_pct` is %, and so on).
  - The brain and energy parts provide `bus.*`, `gpio.*`, `net.*` and `power.*`, which other parts list in `electrical.requires`.
  - Every `requires` entry must be provided by a draft or active part.
- **Environment flags** are the fixed list in `KNOWN_ENVIRONMENT_FLAGS`, plus `temp:<min>..<max>C`.
- **I²C:** two live parts with the same `i2c_address` fail validation unless `i2c-shared.json` has an entry for them.
- **Currents** are typicals from the datasheet unless `SOURCES.md` says otherwise. Where no idle figure is published, idle is set equal to active so power math errs conservative.
- **Changing a part:** a published `(id, version)` is immutable (§4). Bump the semver for any change, and use `deprecated` plus `successor` to retire a part in favour of another.

## Commands

```sh
pnpm --filter @albusforge/registry validate   # also runs as this package's lint task
pnpm --filter @albusforge/registry schemas    # regenerate schemas/ after editing packages/schema
pnpm --filter @albusforge/registry test
```

Loading the registry into Postgres (`scripts/load.ts`, §5) comes with the gateway work, not here.
