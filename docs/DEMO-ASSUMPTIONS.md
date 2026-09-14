# Demo assumptions: every guessed, estimated and mocked value

**Status: none of the values in this document are authoritative.**

The hackathon demo needs the registry to describe a build made from hardware
the user physically has (a Freenove ESP32-S3-WROOM CAM board, Adafruit STEMMA
soil sensors, BH1750 and BME280 breakouts, SG90 servos and a USB-C supply).
Producing that description required guesses. Mocks were explicitly authorised
**on the condition that every one of them is tracked here** so it can be
replaced.

Read this before quoting any number from the registry as fact, before shipping
an enclosure cut from these dimensions, and before believing a green matcher
result means a driver actually compiles.

- Scope of the change: `registry/` and `docs/` only.
- Registry validator: `pnpm --filter @albusforge/registry lint` — passing
  (18 part versions, 6 active, 12 draft, 7 connectors).
- Registry tests: `pnpm --filter @albusforge/registry test` — 125 passing.

---

## 0. The one structural thing to know first

### The 1.0.0 drafts are still in the database, and were deliberately not edited

Production `/v1/parts` returns all twelve original parts at `1.0.0` with
`status: "draft"`, so those rows are already in `registry.parts`.
`registry/scripts/load.ts` treats `(id, version)` as immutable: it compares the
incoming `status` and `definition` against the stored row and throws
`ImmutableVersionError`, rolling back the whole transaction, if either differs.

Promoting a part by editing its `1.0.0` file in place would therefore fail the
`registry-load` job and take the whole deploy down with it.

So promotion was done by **adding a new version beside the old one**:

| Part | Stays in the DB as | The demo build pins |
| --- | --- | --- |
| BH1750 | `V-005@1.0.0` draft, file unchanged | `V-005@1.1.0` active |
| BME280 | `P-001@1.0.0` draft, file unchanged | `P-001@1.1.0` active |
| USB-C supply | `E-005@1.0.0` draft, file unchanged | `E-005@1.1.0` active |
| SG90 servo | `M-001@1.0.0` draft, file unchanged | `M-001@1.1.0` active |

**Do not "tidy up" by deleting the 1.0.0 files.** The loader would still find
the rows in the database, but the drafts on disk are what keeps the load a
no-op; more importantly, old build plans pin `(id, version)` forever.

### The multi-version directory layout is new and needs sign-off

`registry/parts/<ID>/` held exactly one `part.json`, and
`registry/scripts/lib/load.ts` read exactly that one file per directory, so the
layout could not express two versions of one part — even though
`scripts/lib/rules.ts` already has a `duplicate-version` rule that only makes
sense if several files can define the same id.

This change adds the smallest structure that closes the gap:

```
registry/parts/V-005/part.json            # 1.0.0, draft, already loaded
registry/parts/V-005/versions/1.1.0.json  # 1.1.0, active, what the demo pins
registry/parts/V-005/footprint.step       # shared by both versions
```

`loadRegistry` now reads `part.json` plus any `versions/*.json` in the same
folder, all under the folder's part id. Everything downstream (the
`duplicate-version` check, the catalogue's highest-version-wins selection, the
DB loader) already handled multiple versions per id and needed no change.

| What | Why it is not authoritative | What replaces it |
| --- | --- | --- |
| `versions/<semver>.json` naming | Invented for this change; there was no prior convention, and no ADR covers it | A decision from whoever owns the registry layout. The alternatives considered were `part@1.1.0.json` beside `part.json`, and a flat `parts/<ID>-<version>/` directory (rejected: it breaks the `folder-id` rule) |

---

## 1. New connector

### `registry/connectors/stemma-i2c-ph-4pin-v1.json`

Needed because the Adafruit STEMMA soil sensor uses **JST PH 2.0 mm**, while
the registry's existing `hsx-i2c-4pin-v1` is **JST SH 1.0 mm** (STEMMA QT /
Qwiic). They do not mate.

| Field | Value used | Why it is not authoritative | What replaces it |
| --- | --- | --- | --- |
| `max_voltage` | 5.5 | Copied from `hsx-i2c-4pin-v1`. The JST PH series is rated well above this; 5.5 V is a house convention for "5 V logic plus margin", not a connector rating | A decision on what `max_voltage` means in this schema — connector rating or bus convention — and the JST PH datasheet if it is the former |
| `name` | "Adafruit STEMMA I2C, JST PH pinout" | Names a vendor convention rather than an HSX part, unlike the `hsx-*` connectors | A naming decision if HSX standardises on its own PH connector |
| pin order GND, VCC, SDA, SCL | Adafruit's documented STEMMA cable order | Sourced from the vendor guide, not measured on the user's cables | Continuity-check the user's actual JST PH cables |

---

## 2. New part: `C-002` — Freenove ESP32-S3-WROOM CAM (N16R8)

Full detail in `registry/parts/C-002/SOURCES.md`. The chip-level numbers come
from the Espressif ESP32-S3 datasheet v2.2 and are sound. **The board-level
numbers are guesses**, because Freenove publishes a tutorial repo and a pinout,
not a schematic with regulator part numbers.

| Field | Value used | Why it is not authoritative | What replaces it |
| --- | --- | --- | --- |
| `electrical.voltage_range` | `[4.13, 5.5]` | Copied verbatim from C-001, which derived it from a *specific* LDO (SGM2212) and Schottky (1N5819HW) that this board may not use | Identify the regulator and input protection on the Freenove board, then redo C-001's dropout arithmetic |
| `electrical.alt_inputs` | 5v-pin `[3.68, 5.5]`, 3v3-pin `[3.0, 3.6]` | Same copied-from-C-001 reasoning. The 3v3-pin window is the chip's VDD and is sound; the 5v-pin window is not | Same as above |
| `electrical.supply.output_v` | `[3.2, 3.4]` | A generic ±3 % 3.3 V LDO window. The real regulator is unidentified | The LDO's datasheet window over load and temperature |
| `electrical.supply.max_output_ma` | 600 | Deliberately pessimistic guess. The camera, PSRAM and SD card already sit on this rail, so peripherals get less than C-001's 800 mA | Read the LDO rating, then measure headroom while streaming |
| `electrical.current_draw_ma.active` | 500 | Only the 340 mA Wi-Fi TX peak is sourced; the remaining ~160 mA for camera + PSRAM + SD is invented | Bench measurement on the 5 V input while streaming over Wi-Fi |
| `electrical.current_draw_ma.idle` | 0.02 | The chip's 7 µA deep sleep is sourced; it was raised because the camera regulator, SD card and power LED do not sleep. The multiplier is invented | Bench measurement in deep sleep |
| `mechanical.bounding_mm` | `[65.0, 26.0, 14.0]` | Ruler-class estimate with the camera fitted. Not measured with calipers | Caliper measurement, or a Freenove mechanical drawing |
| `mechanical.mount.holes_mm` | four holes inset 2.5 mm from each corner | **Invented.** Hole positions were derived from the (also estimated) bounding box, not observed | Measure hole centres from the board corner |
| `mechanical.mount.hole_d_mm` | 2.2 | Typical M2 clearance for this board class | Measure |
| `mechanical.exposure` | `window` | Chosen because the camera must see out. Whether it is a window, a lens bezel or an open aperture is an enclosure decision nobody has made | The fit spike / enclosure design |
| `commerce.suppliers` | DigiKey `1738-FNK0085-ND` | The Freenove listing for this board family; the exact SKU for the N16R8 + camera bundle was **not** confirmed to load | Open the vendor page and confirm the SKU and that it is the camera variant |
| `commerce.unit_cost_usd` | 21.95 | Typical street price, not a checked cart | A checked vendor listing |
| `cloud.telemetry_schema` | `device_health.v1` | Copied from C-001 | Confirm the board reports the same health channel |

### Schema gaps this part exposes (not fixable inside `registry/`)

| Gap | Consequence | What would fix it |
| --- | --- | --- |
| **16 MB flash / 8 MB PSRAM are not expressible.** `PartDefinition` has no memory fields | The N16R8 sizes survive only in `C-002.name`, in `SOURCES.md`, and in `firmware/esp32s3-camera/partitions.csv`. Nothing validates that the partition table fits the flash the registry thinks the board has | Memory fields on `PartElectrical` or a new `PartCompute` block in `packages/schema/src/part.ts` |
| **No camera capability.** `read.*` capabilities must end in a unit suffix from `UNIT_SUFFIXES` (`_c`, `_pct`, `_lux`, …) and there is no image suffix | C-002 advertises no camera capability. The matcher can select it as a brain but **cannot select it for its camera**, and an ask like "take a photo of my plant" still fails closed at capability matching | An image/frame unit in `packages/schema/src/units.ts` plus a `read.image_*` capability. Out of scope here: `packages/schema` is owned by another agent this cycle |
| **The microSD slot is not expressible** | Local buffering cannot be planned from the registry | Same as the memory gap |

---

## 3. New part: `P-006` — Adafruit STEMMA Soil Sensor #4026

Full detail in `registry/parts/P-006/SOURCES.md`. Address, connector, voltage
and logic level are vendor-sourced and sound.

| Field | Value used | Why it is not authoritative | What replaces it |
| --- | --- | --- | --- |
| `electrical.current_draw_ma` | 1.5 idle / 5.0 active | Adafruit publishes no current figure; this is a guess for an ATSAMD10 plus capacitive drive | Bench measurement on the 3.3 V rail |
| `mechanical.bounding_mm` | `[95.0, 15.0, 4.0]` | Ruler-class estimate of the PCB blade | Caliper measurement |
| `mechanical.mount` | `cable-gland`, `d_mm` 5 | Sized for the JST PH cable, not the blade. Whether the probe leaves through a gland at all is undecided | The fit spike |
| `environment_flags` | `temp:0..50C` | Assumed indoor-plant range; not a rated figure | The board's actual rated range |
| `commerce.unit_cost_usd` | 7.50 | Typical listed price, not a checked cart | A checked vendor listing |
| **Raw-count → percent calibration** | **Missing entirely** | The capability is `read.soil_moisture_pct`, but seesaw returns a raw capacitance count (roughly 200 dry / 2000 in water). The driver must map it, and the end points are uncalibrated | Two measurements per probe: dry air and saturated soil. **This one changes displayed readings**, so it matters more than most rows here |
| Two units on one bus | Both of the user's sensors default to `0x36` | The registry models one part, not two instances; address jumpers are a physical change nobody has made | Set the address jumper on the second unit, then confirm the assembly profile allocates both addresses |

---

## 4. Promotions to `status: "active"`

All six parts the demo build needs are now active. Values added purely to
satisfy the "not a draft" checks in `packages/schema/src/part.ts` are marked.

| Part | Field added for promotion | Value | Why it is not authoritative | What replaces it |
| --- | --- | --- | --- | --- |
| `V-005@1.1.0` | `mechanical.mount` | `standoffs`, 2.5 mm holes at (2.5, 2.5), (2.5, 15.2), (22.8, 2.5), (22.8, 15.2) | **Invented.** Inset from the bounding box; not measured | Caliper measurement, or Adafruit's EagleCAD files for #4681 |
| `P-001@1.1.0` | `mechanical.mount` | `standoffs`, 2.5 mm holes at (2.5, 2.5), (2.5, 15.5), (22.7, 2.5), (22.7, 15.5) | **Invented.** Same method | Caliper measurement, or Adafruit's EagleCAD files for #2652 |
| `E-005@1.1.0` | none | — | Only `status` changed; everything else was already sourced | — |
| `M-001@1.1.0` | `electrical.logic_v` | `[3.0, 5.5]` | **Invented.** No SG90 sheet states a control-input threshold. Chosen so 3.3 V hosts fall inside it and the validator passes. If the real threshold is above 3.3 V the servo will twitch or not move, and the registry will have said it was fine | Scope the signal pin driven from 3.3 V PWM on the user's actual servos |
| `M-001@1.1.0` | `mechanical.mount` | `tabs`, 2.2 mm holes, 27.8 mm spacing | **Estimate.** The commonly cited SG90 figure; SparkFun's generic sub-micro servo says 29.0 mm / 2.0 mm | Caliper measurement of the user's four servos |
| `M-001@1.1.0` | `commerce.suppliers` | Adafruit #169 | **A substitute part.** #169 is a TowerPro SG92R, not an SG90 (3–6 V, 23 × 11 × 29 mm). Listed only so the part can leave draft | A confirmed SG90 listing, or renaming M-001 to the SG92R and re-measuring |
| `M-001@1.1.0` | `commerce.unit_cost_usd` | 5.95 | The substitute's price | Whatever the corrected supplier row costs |
| `C-002@1.0.0`, `P-006@1.0.0` | born active | — | See sections 2 and 3 | — |

### Side effect: a second host changed two validator outputs

Adding C-002 as a second `host` part means every peripheral's logic level is now
checked against two hosts.

| Change | Why | What replaces it |
| --- | --- | --- |
| New `registry/known-issues.json` entry `["V-004", "C-002"]` | The HC-SR04's 5 V echo mismatches C-002's 3.3 V IO exactly as it mismatches C-001's. Without the entry the validator fails | Remove it together with the C-001 entry, when the schema can express level shifting or V-004 becomes a 3.3 V part. V-004 is **not** in the demo build |
| `registry/test/power.test.ts` expectations now list both hosts | The golden-build power-path failure messages name every host | Nothing; this is a correct test update |

---

## 5. Footprints: all six are placeholders

`registry/scripts/lib/rules.ts` refuses `status: "active"` unless
`parts/<ID>/<footprint_file>` exists. No footprint existed for any part.

Each of the six files below is a **hand-written ISO-10303-21 stub** carrying a
header comment marked `PLACEHOLDER GEOMETRY - NOT A REAL PART MODEL` and a
single axis-aligned bounding box taken from the part's `bounding_mm`. There are
no connectors, headers, mounting bosses, cable exits or keep-out volumes.

| File | Box (mm) | Why it is not authoritative | What replaces it |
| --- | --- | --- | --- |
| `registry/parts/C-002/footprint.step` | 65.0 × 26.0 × 14.0 | Placeholder stub; the box itself is an estimate (section 2) | A real STEP export from Freenove, or a measured model |
| `registry/parts/P-006/footprint.step` | 95.0 × 15.0 × 4.0 | Placeholder stub; box estimated (section 3) | A real STEP export, or a measured model |
| `registry/parts/V-005/footprint.step` | 25.3 × 17.7 × 4.5 | Placeholder stub; the box is from the existing part definition | Adafruit's STEP/EagleCAD for #4681 |
| `registry/parts/P-001/footprint.step` | 25.2 × 18.0 × 4.6 | Placeholder stub; box from the existing part definition | Adafruit's STEP/EagleCAD for #2652 |
| `registry/parts/E-005/footprint.step` | 45.0 × 45.0 × 27.0 | Placeholder stub. The supply is `mount: external`, so bodygen should never fit it anyway | A vendor model, if it is ever needed |
| `registry/parts/M-001/footprint.step` | 32.0 × 12.2 × 31.0 | Placeholder stub. A servo is the **worst** case for a bounding box: the tabs, horn and cable all sit outside a plain prism | A real SG90 STEP model |

**Consequence to state plainly:** any enclosure generated from these files is a
box-fit exercise. It will not have correct cable exits, will not clear the
camera lens, and will not locate a single mounting boss correctly.

---

## 6. Compat matrix: asserted, not compiled

`apps/matcher/src/constraints.ts` fails a plan unless
`registry.compat_matrix` holds a row with `status = "passed"` for
`(driver_pkg, driver_ver, runtime_ver, brain_id)`. That table had **no
file-based seed anywhere in the repo** — the only writers were test fixtures in
`apps/intake` and `apps/gateway`. `docs/ARCHITECTURE.md` §22 says the rows are
"generated, never hand-maintained" by a CI matrix job that does not exist yet.

This change adds `registry/compat-matrix.json`, validated and inserted by
`registry/scripts/load.ts` (`readCompatRows` / `loadCompat`, insert with
`onConflictDoNothing`, so re-running is a no-op).

| Row | Why it is not authoritative | What replaces it |
| --- | --- | --- |
| `hsx-driver-seesaw-soil` 0.1.0 / runtime 0.1.0 / C-002 → `passed` | **Nothing has been compiled.** The driver package does not exist yet | The CI matrix job of ARCHITECTURE.md §22, writing rows from a real build |
| `hsx-driver-bh1750` 0.1.0 / runtime 0.1.0 / C-002 → `passed` | Same. Never built against this brain | Same |
| `hsx-driver-bme280` 0.1.0 / runtime 0.1.0 / C-002 → `passed` | Same | Same |
| `hsx-driver-servo-pwm` 0.1.0 / runtime 0.1.0 / C-002 → `passed` | Same | Same |
| The hand-maintained file itself | Contradicts ARCHITECTURE.md §22's "generated, never hand-maintained" | Delete the file and its loader hook once the CI matrix job lands |
| No rows for brain `C-001` | Only C-002 was asked for. Any plan pinning C-001 still fails the compatibility constraint | Rows from the CI job, for every brain |
| No rows for drafts' drivers (`hsx-driver-ds18b20`, `hsx-driver-mpu6050`, …) | Those parts stay draft and are off the catalogue, so the matcher will not pick them | Same |

**This is the most dangerous mock in this document**, because a green matcher
result now asserts a compile that never happened. A plan can pass every
constraint and still produce firmware that does not build.

---

## 7. Drivers and SDK modules that do not exist yet

| Name | Declared on | Status | What replaces it |
| --- | --- | --- | --- |
| `hsx-driver-seesaw-soil` @ `0.1.0` | `P-006` | **Package does not exist.** The name is reserved here | The real driver, published at a version the part then pins |
| `sensors/soil` | `P-006` | SDK module path asserted, not implemented | The real SDK module |
| `soil_moisture.v1` | `P-006` | Telemetry schema id reused from P-005; whether a schema document exists was not checked from this change | Confirm the schema is registered in cloudlink |
| `hsx-driver-bh1750`, `hsx-driver-bme280`, `hsx-driver-servo-pwm` @ `0.1.0` | `V-005`, `P-001`, `M-001` | Pre-existing declarations, carried into the 1.1.0 versions unchanged. Their existence was not verified by this change | Verify they are published at 0.1.0 |

---

## 8. What to do first when there is time

Ordered by how much damage the guess does if left in place.

1. **Calibrate the soil sensors** (section 3). Wrong here means wrong numbers
   on screen, presented as readings.
2. **Verify `M-001.logic_v`** (section 4). Wrong here means a servo that does
   not move while the registry says the wiring is fine.
3. **Replace the compat rows with a real compile** (section 6). Wrong here
   means firmware that does not build after the plan said it would.
4. **Measure `C-002`'s power numbers** (section 2). Wrong here means a rail
   that browns out under camera load.
5. **Caliper every `bounding_mm` and mount** (sections 2–5), then export real
   STEP files.
6. **Get sign-off on the `versions/` layout** (section 0) and on whether
   `M-001` is an SG90 or an SG92R.
