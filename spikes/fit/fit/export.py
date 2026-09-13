"""Export a built enclosure: print-oriented STLs, a STEP assembly and a viewer GLB.

The lint runs on the STL files after they're written, and its report is saved
next to them. A failing lint still writes the files, so they can be inspected,
but `export` reports `passed: false` and the CLI exits non-zero.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import cadquery as cq
import trimesh

from .enclosure import Enclosure, print_lid, print_orient
from .lint import lint_mesh, lint_params, passed
from .model import Layout

STL_TOLERANCE_MM = 0.05
STL_ANGULAR_TOLERANCE = 0.1
MM_TO_M = 0.001  # glTF units are metres

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


def viewer_glb(enc: Enclosure) -> bytes:
    """The model for the portal's enclosure viewer (apps/web/src/components/enclosure/scene.ts).

    - glTF conventions: metres, Y up, centred in plan, floor at y = 0.
    - The lid is at rest; the viewer lifts it for the exploded view.
    - Nodes: `base`; `lid`, with each hatch as a child so it hides and lifts with the lid;
      and `parts`, a group holding one ghost per part, named by part id.
    - GLTFLoader strips `[ ] . : /` from node names, so names use none of them.
    """
    W, D, _ = enc.outer
    tf = trimesh.transformations
    to_gltf = (
        tf.scale_matrix(MM_TO_M)
        @ tf.rotation_matrix(-math.pi / 2, [1, 0, 0])  # (x, y, z) -> (x, z, -y)
        @ tf.translation_matrix([-W / 2, -D / 2, 0])
    )

    def mesh(shape: cq.Workplane, rgba: list[float]) -> trimesh.Trimesh:
        m = _mesh(shape, rgba)
        m.apply_transform(to_gltf)
        return m

    scene = trimesh.Scene()
    scene.add_geometry(mesh(enc.base, COLORS["base"]), node_name="base", geom_name="base")
    scene.add_geometry(mesh(enc.lid, COLORS["lid"]), node_name="lid", geom_name="lid")
    for part_id, hatch in enc.hatches:
        name = f"hatch-{part_id}"
        scene.add_geometry(
            mesh(hatch, COLORS["lid"]), node_name=name, geom_name=name, parent_node_name="lid"
        )
    scene.graph.update(frame_from=scene.graph.base_frame, frame_to="parts")
    for part_id, ghost in enc.ghosts:
        scene.add_geometry(
            mesh(ghost, COLORS["ghost"]),
            node_name=part_id,
            geom_name=f"ghost-{part_id}",
            parent_node_name="parts",
        )
    return scene.export(file_type="glb")


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

    (out / "enclosure.glb").write_bytes(viewer_glb(enc))

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
