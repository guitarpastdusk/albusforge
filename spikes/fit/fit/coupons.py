"""Tolerance coupons: quick prints that set the tolerance table before any enclosure.

Each coupon varies one dimension over six steps. Dimples beside each feature count
the step: one dimple is the tightest. Record the tightest step that fits without
force in fit-results.csv; that value goes into the printer's `overrides` in
printers/<id>.json, with its `version` bumped and `calibrated` set once all are in.
"""

from __future__ import annotations

import json
from pathlib import Path

import cadquery as cq
import trimesh

from .enclosure import _box, roofed_rect, teardrop
from .lint import lint_mesh, passed

RADIAL_STEPS = (0.1, 0.2, 0.3, 0.4, 0.5, 0.6)
TAP_STEPS_M25 = (1.9, 2.0, 2.1, 2.2, 2.3, 2.4)
PEG_D = 8.0
PCB_T = 1.6  # measure the boards: C-001 1.6, E-004 often 1.2
USB_C_PLUG = (12.35, 6.5)  # USB-IF Type-C compliance max overmold (rev 1.2, p. 46)
PROBE_D = 6.0
DIMPLE_D, DIMPLE_DEPTH, DIMPLE_PITCH = 1.0, 0.6, 1.8

# coupon -> what it varies and the tolerance key its result sets
LEGEND = {
    "hole-plate": ("radial clearance of an 8 mm peg (print `peg` too)", RADIAL_STEPS, "part_clearance_mm"),
    "slot-block": (f"radial clearance of a {PCB_T} mm PCB edge in a slot", RADIAL_STEPS, "cradle_clearance_mm"),
    "port-wall": (f"clearance around a USB-C plug overmold {USB_C_PLUG}", RADIAL_STEPS, "port_clearance_mm"),
    "gland-wall": (f"radial clearance of a {PROBE_D} mm probe through a teardrop hole", RADIAL_STEPS, "gland_clearance_mm (with mount.d_mm = measured probe diameter)"),
    "pilot-posts": ("pilot hole diameter for an M2.5 self-tapping screw", TAP_STEPS_M25, "self_tap_hole_d_mm.M2.5"),
    "lid-c*": ("lid lip clearance in `lid-frame` (one lid per step)", RADIAL_STEPS, "lid_lip_clearance_mm"),
}


def _dimples(body: cq.Workplane, x: float, y: float, z_top: float, count: int) -> cq.Workplane:
    for i in range(count):
        dx = x + (i - (count - 1) / 2) * DIMPLE_PITCH
        dimple = cq.Workplane("XY").circle(DIMPLE_D / 2).extrude(DIMPLE_DEPTH + 0.1)
        body = body.cut(dimple.translate((dx, y, z_top - DIMPLE_DEPTH)))
    return body


def hole_plate() -> cq.Workplane:
    pitch = 14.0
    plate = _box(0, 4 + pitch * len(RADIAL_STEPS), 0, 20, 0, 4)
    for i, c in enumerate(RADIAL_STEPS):
        x = 2 + pitch / 2 + i * pitch
        plate = plate.cut(cq.Workplane("XY").circle(PEG_D / 2 + c).extrude(6).translate((x, 12, -1)))
        plate = _dimples(plate, x, 3.0, 4, i + 1)
    return plate


def peg() -> cq.Workplane:
    return _box(0, 14, 0, 14, 0, 2).union(
        cq.Workplane("XY").circle(PEG_D / 2).extrude(12).translate((7, 7, 2))
    )


def slot_block() -> cq.Workplane:
    pitch = 14.0
    block = _box(0, 4 + pitch * len(RADIAL_STEPS), 0, 20, 0, 10)
    for i, c in enumerate(RADIAL_STEPS):
        x = 2 + pitch / 2 + i * pitch
        hw = PCB_T / 2 + c
        block = block.cut(_box(x - hw, x + hw, 6, 18, 5, 11))
        block = _dimples(block, x, 3.0, 10, i + 1)
    return block


def _wall(width: float, height: float, openings: list[list[tuple[float, float]]]) -> cq.Workplane:
    """A 2 mm wall standing on a footing; openings are (x, z) outlines cut through it."""
    body = _box(0, width, 0, 14, 0, 2).union(_box(0, width, 6, 8, 0, height))
    # Normal -y, so local y is world z; extruding 4 mm from y = 9 clears the wall.
    plane = cq.Plane(origin=(0, 9, 0), xDir=(1, 0, 0), normal=(0, -1, 0))
    for pts in openings:
        body = body.cut(cq.Workplane(plane).polyline(pts).close().extrude(4))
    return body


def port_wall() -> cq.Workplane:
    pitch = 17.0
    openings, xs = [], []
    for i, c in enumerate(RADIAL_STEPS):
        x = 2 + pitch / 2 + i * pitch
        hw, hh = USB_C_PLUG[0] / 2 + c, USB_C_PLUG[1] / 2 + c
        openings.append(roofed_rect(x, 3.5 + hh, hw, hh))
        xs.append(x)
    body = _wall(4 + pitch * len(RADIAL_STEPS), 22, openings)
    for i, x in enumerate(xs):
        body = _dimples(body, x, 2.5, 2, i + 1)
    return body


def gland_wall() -> cq.Workplane:
    pitch = 12.0
    openings, xs = [], []
    for i, c in enumerate(RADIAL_STEPS):
        x = 2 + pitch / 2 + i * pitch
        r = PROBE_D / 2 + c
        openings.append(teardrop(x, 3.5 + r, r))
        xs.append(x)
    body = _wall(4 + pitch * len(RADIAL_STEPS), 16, openings)
    for i, x in enumerate(xs):
        body = _dimples(body, x, 2.5, 2, i + 1)
    return body


def pilot_posts(profile: dict) -> cq.Workplane:
    pitch, od = 10.0, profile["standoff_od_mm"]
    plate = _box(0, 4 + pitch * len(TAP_STEPS_M25), 0, 16, 0, 2)
    for i, d in enumerate(TAP_STEPS_M25):
        x = 2 + pitch / 2 + i * pitch
        plate = plate.union(cq.Workplane("XY").circle(od / 2).extrude(8).translate((x, 11, 2)))
        plate = plate.cut(cq.Workplane("XY").circle(d / 2).extrude(8).translate((x, 11, 3)))
        plate = _dimples(plate, x, 3.5, 2, i + 1)
    return plate


LID_INNER, LID_WALL, LID_LIP = 30.0, 2.0, 3.0


def lid_frame() -> cq.Workplane:
    outer = LID_INNER + 2 * LID_WALL
    return _box(0, outer, 0, outer, 0, 10).cut(
        _box(LID_WALL, LID_WALL + LID_INNER, LID_WALL, LID_WALL + LID_INNER, 2, 11)
    )


def lid(c: float, step: int, profile: dict) -> cq.Workplane:
    """Plate-down, as printed."""
    outer, m = LID_INNER + 2 * LID_WALL, profile["lint"]["min_wall_mm"]
    lo, hi = LID_WALL + c, LID_WALL + LID_INNER - c
    ring = _box(lo, hi, lo, hi, 2, 2 + LID_LIP).cut(_box(lo + m, hi - m, lo + m, hi - m, 1, 3 + LID_LIP))
    plate = _box(0, outer, 0, outer, 0, 2).union(ring)
    return _dimples(plate, outer / 2, outer / 2, 2, step)


def build_coupons(profile: dict) -> dict[str, cq.Workplane]:
    bodies = {
        "hole-plate": hole_plate(),
        "peg": peg(),
        "slot-block": slot_block(),
        "port-wall": port_wall(),
        "gland-wall": gland_wall(),
        "pilot-posts": pilot_posts(profile),
        "lid-frame": lid_frame(),
    }
    for i, c in enumerate(RADIAL_STEPS):
        bodies[f"lid-c{c}"] = lid(c, i + 1, profile)
    return bodies


def export_coupons(profile: dict, out_root: str | Path) -> dict:
    out = Path(out_root) / "coupons"
    out.mkdir(parents=True, exist_ok=True)
    report: dict = {"profile": profile["profile"], "bodies": {}}
    for name, body in build_coupons(profile).items():
        path = out / f"{name}.stl"
        cq.exporters.export(body, str(path), tolerance=0.05, angularTolerance=0.1)
        report["bodies"][name] = lint_mesh(trimesh.load(path, force="mesh"), profile)
    report["legend"] = {
        k: {"varies": v, "steps": list(s), "sets": key} for k, (v, s, key) in LEGEND.items()
    }
    report["passed"] = all(passed(c) for c in report["bodies"].values())
    (out / "coupons.json").write_text(json.dumps(report, indent=2) + "\n")
    return report
