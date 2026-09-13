# Fit spike

Tests the riskiest assumption in [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) §15: **enclosures
generated from Part Definitions fit the real parts on the first print, at least 90% of the time.** It runs
ahead of M5 so the answer arrives before bodygen is built ([`ASK-TO-ENCLOSURE.md`](../../docs/ASK-TO-ENCLOSURE.md) §5).

This is a spike, not bodygen. It has no pipeline, database or Cloud Run: layouts are hand-placed JSON, and
everything runs locally.

## Run it

```sh
cd spikes/fit
uv sync
uv run pytest
uv run python -m fit coupons                              # every printer: out/<printer>/coupons/
uv run python -m fit build layouts/*.json                 # every printer: out/<printer>/<layout>/
uv run python -m fit build layouts/*.json --printer bambu-a1,prusa-core-one
```

Each layout writes `base.stl`, `lid.stl`, one `hatch-<part>.stl` per battery part, `enclosure.step`,
`enclosure.glb` and `lint.json`. `build` exits non-zero if any layout is invalid or fails the lint; the files
are written either way, so a failure can be inspected.

On Intel macOS, `pyproject.toml` pins `nlopt`, `numba` and `llvmlite` to the last releases with wheels for
that platform.

## The printer family

The target is a family of printers, not one machine. Unit sales in 2026 are concentrated in a few brands:
Bambu Lab sold roughly one printer in two in the first four months, and Creality about one in four, with
Elegoo, Prusa and Anycubic next ([3druck, citing CONTEXT](https://3druck.com/en/industry-2/3d-printers-boom-bambu-lab-displaces-creality-from-top-spot-04157946/);
[Tom's Hardware](https://www.tomshardware.com/3d-printing/bambu-lab-overtakes-creality-as-the-worlds-top-selling-budget-3d-printer-brand)).
No public source ranks individual models, so the family takes the leading brands' current mainstream
machines, covering both motion types that matter for tolerances (an open bed-slinger and enclosed CoreXY):

| Profile | Printer | Type | Build volume (mm) |
| --- | --- | --- | --- |
| `bambu-a1` | Bambu Lab A1 | open bed-slinger | 256 × 256 × 256 |
| `bambu-p1s` | Bambu Lab P1S (P2S has the same volume) | enclosed CoreXY | 256 × 256 × 256 |
| `creality-k1c` | Creality K1C | enclosed CoreXY | 220 × 220 × 250 |
| `elegoo-centauri-carbon` | Elegoo Centauri Carbon | enclosed CoreXY | 256 × 256 × 256 |
| `prusa-core-one` | Prusa CORE One | enclosed CoreXY | 250 × 220 × 270 |

Picking Prusa over Anycubic for the fifth slot is a judgment call, not a sales ranking; adding or swapping a
printer is one JSON file. Each `printers/<id>.json` cites its sources for the build volume.

**Every printer starts uncalibrated** (`"calibrated": false`) on the shared table
`tolerances/generic-fdm-0.4.json`. No clearance is guessed per printer. Coupons printed on a printer set its
`overrides` ([`PROTOCOL.md`](PROTOCOL.md)). The smallest bed in the family, the K1C's 220 × 220 mm, bounds
every layout; a test checks every layout against every printer.

## What's here

| Path | What it is |
| --- | --- |
| `parts/*.json` | `mechanical` blocks for five MVP parts, plus `spike_ext` (hole patterns, ports, plug sizes) that the Part Definition doesn't have yet. **Part dimensions are nominal and unverified** until measured ([`MEASURE.md`](MEASURE.md)) |
| `printers/*.json` | The printer family: build volume, motion type, sources, tolerance overrides |
| `tolerances/generic-fdm-0.4.json` | The shared tolerance table (v0) every printer inherits |
| `layouts/*.json` | Nine hand-placed layouts. `at` is a part's footprint min corner in cavity coordinates |
| `fit/model.py` | Loading, printer profiles, rotation, cavity size, layout validation (keepouts, ports flush with their wall, glands fit, gland cable paths clear) |
| `fit/enclosure.py` | CadQuery base and lid: cradle posts, standoffs with pilot holes, port and gland cuts, friction-lip lid, vent slots, battery hatches, QR serial |
| `fit/lint.py` | Printability gate: watertight, one body, on the bed, fits the bed, overhangs ≤ 55°, parametric minimum wall |
| `fit/export.py` | Print-oriented STLs, STEP assembly (every body), and the viewer GLB (below) |
| `fit/coupons.py` | Tolerance coupons, one dimension over six steps each |
| [`PROTOCOL.md`](PROTOCOL.md) | How to print, what counts as a fit, how to record it |
| `fit-results.csv` | Results log; also the first draft of the fit-feedback data model |

## Features

- **Ports** are cut to the mating plug, not the receptacle. USB-C uses the USB-IF compliance maximum overmold,
  **12.35 × 6.5 mm**, with a 6.65 mm plug in front of it ([USB Type-C Compliance Document rev 1.2](https://www.usb.org/sites/default/files/USB_Type-C_Compliance_Document_rev_1_2.pdf), p. 46).
  The Type-C spec requires the seated overmold to clear the product's outer surface
  ([USB Type-C spec R2.0](https://www.usb.org/sites/default/files/USB%20Type-C%20Spec%20R2.0%20-%20August%202019.pdf), §3.10.3, Fig. 3-80),
  so the opening passes the overmold and any compliant non-locking plug fits. Locking Type-C plugs are
  larger and not supported.
- **Glands** are teardrop holes sized from `mount.d_mm`. Validation keeps an 8 mm corridor behind each one
  clear of parts, so the probe can go straight in.
- **Battery hatch** over every part flagged `battery`: an opening in the lid, kept inside the lip ring, and a
  separate hatch with a friction plug, a flange on the outer face and a finger notch.
- **QR serial** (ARCHITECTURE.md §7.4) raised 0.6 mm on the inner lid face, 1 mm modules, in a corner clear
  of vents and hatches. It's mirrored so it reads rotated, not mirrored, with the lid turned over.

## Viewer GLB contract

`enclosure.glb` is built for the portal's 360° viewer (M5.5), and follows what
[`apps/web/src/components/enclosure/scene.ts`](../../apps/web/src/components/enclosure/scene.ts) reads. The
exporter adapts to the viewer, not the other way round:

| Rule | Why |
| --- | --- |
| Metres, **Y up**, centred in plan, floor at y = 0 | glTF conventions; the viewer's lights and camera assume them, and the checked-in fixture (`apps/web/scripts/make-enclosure-fixture.mjs`) uses them |
| Root nodes `base`, `lid`, `parts` | The viewer finds them by name; Base view shows `base` and `parts`, Lid view shows `lid` only |
| Lid at rest | The viewer lifts `lid` itself for Exploded view |
| Each hatch is a child of `lid`, named `hatch-<part-id>` | It hides and lifts with the lid |
| `parts` is a group with one ghost per part, named by part id | The Parts toggle hides the group |
| No `[ ] . : /` in node names | GLTFLoader strips them, which would break lookups by name |

`test_viewer_glb_matches_the_portal_viewer_contract` checks the node tree in the raw glTF JSON, and units, axis
and centring from the bounds, for every layout.

## Known limits of v0

- **Cradle parts are located in x and y only.** Nothing holds them down; the lid doesn't press on them.
  Whether that matters is one of the fit checks.
- **Minimum wall is checked from parameters,** including the floor left under pilot holes and port
  openings, not measured on the mesh.
- **Not built yet:** snap-fit lid (the friction lid is tested by the lid coupons), condensation drains.
- **The QR code is the lid's own colour.** It may need a filament change at its layers, or a light angle, to scan.
- **Ports assume one cable per wall opening.** The ESP32-S3's two USB-C openings overlap at plug size.

## Findings so far, before any print

1. **A receptacle-sized USB-C cutout doesn't work.** The plug overmold (up to 12.35 × 6.5 mm) can't reach
   the receptacle through a 2 mm wall. Ports need a `plug` size, and the Part Definition needs the mating
   connector, not just the part's own outline.
2. **`bounding_mm` isn't enough for bodygen.** Every enclosure feature needed data the schema lacks: hole
   patterns, port positions and sides, PCB thickness, and a z datum (for example, whether header pins count).
   These are proposed as `mechanical` fields in the §18.2 schema decisions.
3. **Cradle mounts cost layout space.** Corner posts need clearance plus a wall on every side, so packing
   has to know the mount type, not just the bounding box.
4. **Connector openings, not parts, can set the box height.** In the short layouts, the USB-C plug opening
   with its 45° roof was taller than the wall. The cut went through the top and left a loose sliver of
   wall, and the STL still counted as watertight. The cavity now grows to keep every opening below the lid
   lip, and the lint has a `single_body` check.
5. **Lid features can break the mesh.** QR modules touching only at a corner share an edge, which makes the
   STL non-manifold. Modules are inset 0.05 mm per side.
6. **Plug openings also bound the floor.** The TP4056's USB-C sits 2.8 mm above its board bottom, so a
   6.5 mm overmold opening cut the floor to 1.05 mm, and the parametric wall check didn't see it. Parts are
   now raised (on a pedestal) until every opening clears the floor, pilot holes stop at the minimum wall, and
   the check includes both residuals.
