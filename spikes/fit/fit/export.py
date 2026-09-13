"""Export a built enclosure: print-oriented STLs, a STEP assembly and a viewer GLB.

The lint runs on the STL files after they're written, and its report is saved
next to them. A failing lint still writes the files, so they can be inspected,
but `export` reports `passed: false` and the CLI exits non-zero.
"""

from __future__ import annotations

import json
from pathlib import Path

import cadquery as cq
import trimesh

from .enclosure import Enclosure, print_lid, print_orient
from .lint import lint_mesh, lint_params, passed
from .model import Layout

STL_TOLERANCE_MM = 0.05
STL_ANGULAR_TOLERANCE = 0.1
EXPLODE_MM = 15.0

COLORS = {
    "base": [0.56, 0.72, 0.87, 1.0],
    "lid": [0.94, 0.65, 0.56, 1.0],
    "ghost": [0.49, 0.78, 0.75, 0.35],
}


def _mesh(shape: cq.Workplane, rgba: list[float]) -> trimesh.Trimesh:
    verts, tris = shape.val().tessellate(STL_TOLERANCE_MM, STL_ANGULAR_TOLERANCE)
    mesh = trimesh.Trimesh(vertices=[v.toTuple() for v in verts], faces=tris, process=True)
    mesh.visual = trimesh.visual.TextureVisuals(
        material=trimesh.visual.material.PBRMaterial(
            baseColorFactor=rgba, alphaMode="BLEND" if rgba[3] < 1 else "OPAQUE"
        )
    )
    return mesh


def export(layout: Layout, enc: Enclosure, out_root: str | Path) -> dict:
    out = Path(out_root) / layout.name
    out.mkdir(parents=True, exist_ok=True)
    pr = layout.profile

    bodies = {"base": enc.base, "lid": print_lid(enc, pr)}
    for part_id, hatch in enc.hatches:
        bodies[f"hatch-{part_id}"] = print_orient(hatch)
    for name, shape in bodies.items():
        cq.exporters.export(
            shape,
            str(out / f"{name}.stl"),
            tolerance=STL_TOLERANCE_MM,
            angularTolerance=STL_ANGULAR_TOLERANCE,
        )

    # Every body in its assembled position, hatches included, so CAD gets the whole enclosure.
    assembled = cq.Workplane("XY").newObject(
        [enc.base.val(), enc.lid.val(), *(hatch.val() for _, hatch in enc.hatches)]
    )
    cq.exporters.export(assembled, str(out / "enclosure.step"))

    scene = trimesh.Scene()
    scene.add_geometry(_mesh(enc.base, COLORS["base"]), node_name="base", geom_name="base")
    lid = enc.lid.translate((0, 0, EXPLODE_MM))
    scene.add_geometry(_mesh(lid, COLORS["lid"]), node_name="lid", geom_name="lid")
    for part_id, hatch in enc.hatches:
        name = f"hatch:{part_id}"
        exploded = hatch.translate((0, 0, 2 * EXPLODE_MM))
        scene.add_geometry(_mesh(exploded, COLORS["lid"]), node_name=name, geom_name=name)
    for part_id, ghost in enc.ghosts:
        scene.add_geometry(
            _mesh(ghost, COLORS["ghost"]), node_name=f"ghost:{part_id}", geom_name=f"ghost:{part_id}"
        )
    scene.export(str(out / "enclosure.glb"))

    report = {
        "layout": layout.name,
        "printer": pr["printer"]["id"],
        "calibrated": pr["printer"]["calibrated"],
        "profile": pr["profile"],
        "profile_version": pr["version"],
    }
    report["params"] = lint_params(layout)
    for name in bodies:
        mesh = trimesh.load(out / f"{name}.stl", force="mesh")
        report[name] = lint_mesh(mesh, pr)
    report["bodies"] = list(bodies)
    report["serial"] = enc.qr.serial if enc.qr else None
    report["outer_mm"] = [round(v, 2) for v in enc.outer]
    report["passed"] = all(passed(report[k]) for k in ("params", *bodies))
    (out / "lint.json").write_text(json.dumps(report, indent=2) + "\n")
    return report
