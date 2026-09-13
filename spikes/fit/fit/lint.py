"""Printability lint: a gate, not a suggestion (ARCHITECTURE.md §7.4).

Mesh checks run on the exported STL, so they test the artifact that gets printed.
Minimum wall is checked against the parameters that set every wall, including what
the known cuts leave (floor under pilot holes and port openings), not measured on the
mesh; a general mesh thickness check is left for bodygen proper.
"""

from __future__ import annotations

import math

import numpy as np
import trimesh

from .enclosure import pilot_floor_mm
from .model import Layout

OVERHANG_AREA_TOLERANCE_MM2 = 1.0  # tessellation slivers
BED_EPS_MM = 0.05


def _check(ok: bool, detail: str) -> dict:
    return {"ok": bool(ok), "detail": detail}


def lint_mesh(mesh: trimesh.Trimesh, profile: dict) -> dict:
    """Checks for one printable body, in its print orientation."""
    checks: dict[str, dict] = {}
    checks["watertight"] = _check(
        mesh.is_watertight and mesh.is_winding_consistent and mesh.is_volume,
        f"watertight={mesh.is_watertight} winding={mesh.is_winding_consistent} volume={mesh.is_volume}",
    )

    # Two closed shells are still watertight, so count bodies separately: a cut that
    # frees a sliver of wall has to fail here.
    bodies = mesh.body_count
    checks["single_body"] = _check(bodies == 1, f"{bodies} disconnected bodies")

    zmin = mesh.bounds[0][2]
    checks["on_bed"] = _check(abs(zmin) <= BED_EPS_MM, f"min z {zmin:.3f} mm")

    bx, by, bz = profile["printer"]["bed_mm"]
    ex, ey, ez = mesh.extents
    fits = ez <= bz and ((ex <= bx and ey <= by) or (ex <= by and ey <= bx))
    checks["bed_size"] = _check(fits, f"extents {ex:.1f} x {ey:.1f} x {ez:.1f} mm, bed {bx} x {by} x {bz}")

    max_deg = profile["lint"]["max_overhang_deg"]
    # A downward face is too flat when it's within (90 - max) degrees of horizontal.
    limit = -math.cos(math.radians(90 - max_deg))
    nz = mesh.face_normals[:, 2]
    above_bed = mesh.triangles_center[:, 2] > zmin + BED_EPS_MM
    bad = (nz < limit - 1e-6) & above_bed
    area = float(np.sum(mesh.area_faces[bad]))
    checks["overhang"] = _check(
        area <= OVERHANG_AREA_TOLERANCE_MM2,
        f"{area:.2f} mm² of downward faces flatter than {max_deg}° from vertical",
    )
    return checks


def lint_params(layout: Layout) -> dict:
    """Walls the parameters produce, against the minimum."""
    pr = layout.profile
    m = pr["lint"]["min_wall_mm"]
    walls = {
        "wall": pr["wall_mm"],
        "floor": pr["floor_mm"],
        "lid_plate": pr["floor_mm"],
        "lid_lip_ring": m,
        "cradle_post": m,
    }
    pc = pr["port_clearance_mm"]
    for p in layout.placements:
        if p.part.mount["type"] == "pcb-standoff":
            tap = pr["self_tap_hole_d_mm"][p.part.mount["screw"]]
            walls[f"standoff:{p.part.id}"] = round((pr["standoff_od_mm"] - tap) / 2, 3)
            walls[f"floor_under_pilot:{p.part.id}"] = pilot_floor_mm(pr)
        for port in p.ports():
            # Opening bottom in cavity coords; below zero the cut eats into the floor.
            bottom = p.z0 + port.v - port.opening(pc)[1]
            walls[f"floor_under_port:{p.part.id}.{port.name}"] = round(pr["floor_mm"] + min(0.0, bottom), 3)
    thin = {k: v for k, v in walls.items() if v < m - 1e-9}
    return {
        "min_wall": _check(not thin, f"min {m} mm; " + (f"too thin: {thin}" if thin else f"walls {walls}")),
        "layout": _check(not layout.validate(), "; ".join(layout.validate()) or "placements valid"),
    }


def passed(checks: dict) -> bool:
    return all(c["ok"] for c in checks.values())
