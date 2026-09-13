import io
import json
import re
import struct
from pathlib import Path

import cadquery as cq
import pytest
import trimesh

from fit.coupons import build_coupons, export_coupons
from fit.enclosure import build
from fit.export import _mesh, export, viewer_glb
from fit.lint import lint_mesh, lint_params, passed
from fit.model import (
    DEFAULT_PRINTER,
    ROOT,
    Gland,
    Placement,
    list_printers,
    load_layout,
    load_part,
    load_printer,
)

LAYOUTS = sorted((ROOT / "layouts").glob("*.json"))
PROFILE = load_printer(DEFAULT_PRINTER)


def test_printer_family_loads():
    printers = list_printers()
    assert len(printers) == 5
    for printer_id in printers:
        pr = load_printer(printer_id)
        assert pr["printer"]["id"] == printer_id
        assert len(pr["printer"]["bed_mm"]) == 3 and min(pr["printer"]["bed_mm"]) > 0
        for key in ("wall_mm", "part_clearance_mm", "port_clearance_mm", "lint"):
            assert key in pr, (printer_id, key)


@pytest.mark.parametrize("printer_id", list_printers())
def test_every_layout_fits_every_printer(printer_id):
    for path in LAYOUTS:
        layout = load_layout(path, printer_id)
        assert layout.validate() == [], (printer_id, layout.name)
        pr = layout.profile
        cw, cd, ch = layout.cavity()
        t, f = pr["wall_mm"], pr["floor_mm"]
        W, D, H = cw + 2 * t, cd + 2 * t, f + ch + pr["lid_lip_mm"]
        bx, by, bz = pr["printer"]["bed_mm"]
        fits = H <= bz and ((W <= bx and D <= by) or (W <= by and D <= bx))
        assert fits, (printer_id, layout.name, (W, D, H))


@pytest.fixture(scope="module", params=LAYOUTS, ids=lambda p: p.stem)
def built(request):
    layout = load_layout(request.param)
    return layout, build(layout)


def _inside(shape: cq.Workplane, x: float, y: float, z: float) -> bool:
    return shape.val().isInside(cq.Vector(x, y, z))


def _overlap_volume(a: cq.Workplane, b: cq.Workplane) -> float:
    return sum(s.Volume() for s in a.intersect(b).solids().vals())


def test_layouts_valid(built):
    layout, _ = built
    assert layout.validate() == []


def test_bodies_are_single_valid_solids(built):
    _, enc = built
    for body in (enc.base, enc.lid):
        assert len(body.solids().vals()) == 1
        assert body.val().isValid()


def test_parts_clear_base_and_lid(built):
    _, enc = built
    for part_id, ghost in enc.ghosts:
        assert _overlap_volume(enc.base, ghost) < 1e-3, part_id
        assert _overlap_volume(enc.lid, ghost) < 1e-3, part_id


def test_ports_open_through_wall(built):
    layout, enc = built
    t, f = layout.profile["wall_mm"], layout.profile["floor_mm"]
    cw, cd, _ = layout.cavity()
    for p in layout.placements:
        for port in p.ports():
            z = f + p.z0 + port.v
            x, y = {
                "-x": (t / 2, t + p.at[1] + port.u),
                "+x": (t + cw + t / 2, t + p.at[1] + port.u),
                "-y": (t + p.at[0] + port.u, t / 2),
                "+y": (t + p.at[0] + port.u, t + cd + t / 2),
            }[port.side]
            assert not _inside(enc.base, x, y, z), f"{p.part.id}.{port.name} is blocked"


def test_glands_open_through_wall(built):
    layout, enc = built
    t, f = layout.profile["wall_mm"], layout.profile["floor_mm"]
    cw, cd, _ = layout.cavity()
    for g in layout.glands:
        mid = {"-x": t / 2, "+x": t + cw + t / 2, "-y": t / 2, "+y": t + cd + t / 2}[g.side]
        x, y = (mid, t + g.u) if g.side in ("-x", "+x") else (t + g.u, mid)
        assert not _inside(enc.base, x, y, f + g.v)


def test_standoffs_have_pilot_holes(built):
    layout, enc = built
    pr = layout.profile
    t, f = pr["wall_mm"], pr["floor_mm"]
    for p in layout.placements:
        if p.part.mount["type"] != "pcb-standoff":
            continue
        tap = pr["self_tap_hole_d_mm"][p.part.mount["screw"]]
        z = f + pr["standoff_height_mm"] / 2
        for hx, hy, _ in p.holes():
            assert not _inside(enc.base, t + hx, t + hy, z)
            ring_r = (tap / 2 + pr["standoff_od_mm"] / 2) / 2
            assert _inside(enc.base, t + hx + ring_r, t + hy, z)


def test_vent_slots_open_over_vent_parts(built):
    layout, enc = built
    pr = layout.profile
    t, f = pr["wall_mm"], pr["floor_mm"]
    H = enc.outer[2]
    vents = [p for p in layout.placements if p.part.exposure == "vent"]
    for p in vents:
        fw, fd = p.footprint
        # The middle slot is at the footprint centre when the count is odd, else
        # half a pitch off it; probe both and require one to be open.
        cx, cy = t + p.at[0] + fw / 2, t + p.at[1] + fd / 2
        half = pr["vent_pitch_mm"] / 2
        assert not _inside(enc.lid, cx, cy, H + f / 2) or not _inside(enc.lid, cx + half, cy, H + f / 2)


def test_battery_hatch_opens_and_clears_lid(built):
    layout, enc = built
    pr = layout.profile
    t, f = pr["wall_mm"], pr["floor_mm"]
    H = enc.outer[2]
    battery_parts = [p for p in layout.placements if "battery" in p.part.flags]
    assert len(enc.hatches) == len(battery_parts)
    for p, (part_id, hatch) in zip(battery_parts, enc.hatches):
        assert part_id == p.part.id
        assert len(hatch.solids().vals()) == 1 and hatch.val().isValid()
        cx = t + p.box[0] + p.footprint[0] / 2
        cy = t + p.box[1] + p.footprint[1] / 2
        assert not _inside(enc.lid, cx, cy, H + f / 2), "lid not opened over the battery"
        assert _inside(hatch, cx, cy, H + f / 2), "hatch plug missing"
        assert _overlap_volume(enc.lid, hatch) < 1e-3


def test_qr_serial_is_raised_on_inner_lid(built):
    layout, enc = built
    H = enc.outer[2]
    qr = enc.qr
    assert qr is not None and qr.serial == f"AF-{layout.name}".upper()
    n = len(qr.matrix)
    z = H - 0.3

    def centre(r, c):
        return qr.x + (n - 1 - c + 0.5), qr.y + (n - 1 - r + 0.5)

    # Finder pattern: the corner module is dark, the one diagonally inside it light.
    assert qr.matrix[0][0] and not qr.matrix[1][1]
    assert _inside(enc.lid, *centre(0, 0), z)
    assert not _inside(enc.lid, *centre(1, 1), z)


def test_floor_under_pilots_and_ports_meets_min_wall(built):
    layout, enc = built
    pr = layout.profile
    t, f, m = pr["wall_mm"], pr["floor_mm"], pr["lint"]["min_wall_mm"]
    cw, cd, _ = layout.cavity()
    for p in layout.placements:
        if p.part.mount["type"] == "pcb-standoff":
            for hx, hy, _ in p.holes():
                assert _inside(enc.base, t + hx, t + hy, m - 0.01), f"{p.part.id}: pilot floor < {m} mm"
        for port in p.ports():
            hh = port.opening(pr["port_clearance_mm"])[1]
            assert p.z0 + port.v - hh >= -1e-9, f"{p.part.id}.{port.name} opening dips into the floor"
            x, y = {
                "-x": (t / 2, t + p.at[1] + port.u),
                "+x": (t + cw + t / 2, t + p.at[1] + port.u),
                "-y": (t + p.at[0] + port.u, t / 2),
                "+y": (t + p.at[0] + port.u, t + cd + t / 2),
            }[port.side]
            assert _inside(enc.base, x, y, f - 0.01), f"{p.part.id}.{port.name}: floor cut under opening"


def test_lint_catches_thin_floor_under_a_port():
    layout = load_layout(LAYOUTS[0])
    i = next(i for i, p in enumerate(layout.placements) if p.part.id == "E-004")
    p = layout.placements[i]
    assert p.z0 > 0  # raised so its opening clears the floor
    # At floor level (the old placement) the charger's opening cuts the floor to 1.05 mm.
    layout.placements[i] = Placement(p.part, p.at, p.rot, 0.0)
    check = lint_params(layout)["min_wall"]
    assert not check["ok"] and "floor_under_port:E-004" in check["detail"]


def test_export_lint_passes(built, tmp_path):
    layout, enc = built
    report = export(layout, enc, tmp_path)
    assert report["passed"], report
    for name in ("base.stl", "lid.stl", "enclosure.step", "enclosure.glb", "lint.json"):
        assert (tmp_path / layout.name / name).stat().st_size > 0

    # STEP round trip: every printable body, hatches included, at full volume.
    step = cq.importers.importStep(str(tmp_path / layout.name / "enclosure.step"))
    solids = step.solids().vals()
    bodies = [enc.base, enc.lid, *(hatch for _, hatch in enc.hatches)]
    assert len(solids) == len(bodies) == len(report["bodies"])
    expected = sum(b.val().Volume() for b in bodies)
    assert sum(s.Volume() for s in solids) == pytest.approx(expected, rel=1e-3)


def test_viewer_glb_matches_the_portal_viewer_contract(built):
    """apps/web/src/components/enclosure/scene.ts: nodes base, lid, parts; Y up, metres, lid at rest."""
    layout, enc = built
    glb = viewer_glb(enc)

    # The raw glTF JSON chunk, independent of any loader.
    length = struct.unpack_from("<I", glb, 12)[0]
    doc = json.loads(glb[20 : 20 + length])
    nodes = doc["nodes"]
    names = {i: n["name"] for i, n in enumerate(nodes)}
    by_name = {n["name"]: n for n in nodes}
    assert [names[i] for i in doc["scenes"][0]["nodes"]] == ["base", "lid", "parts"]
    assert [names[c] for c in by_name["lid"].get("children", [])] == [f"hatch-{p}" for p, _ in enc.hatches]
    assert [names[c] for c in by_name["parts"]["children"]] == [p.part.id for p in layout.placements]
    assert "mesh" not in by_name["parts"]
    assert all("mesh" in by_name[n] for n in ("base", "lid"))
    # GLTFLoader's sanitizeNodeName strips these, which would break lookups by name.
    assert not [n for n in names.values() if re.search(r"[\[\].:/]", n)]

    W, D, H = enc.outer
    f = layout.profile["floor_mm"]
    scene = trimesh.load(io.BytesIO(glb), file_type="glb")
    (x0, y0, z0), (x1, y1, z1) = scene.bounds
    mm = 1000
    assert y0 * mm == pytest.approx(0, abs=1e-3)  # floor at y = 0: Y is up
    assert (x1 - x0) * mm == pytest.approx(W, abs=1e-3)
    assert (z1 - z0) * mm == pytest.approx(D, abs=1e-3)
    assert (x0 + x1) / 2 * mm == pytest.approx(0, abs=1e-3)
    assert (z0 + z1) / 2 * mm == pytest.approx(0, abs=1e-3)
    # Lid at rest: nothing above the lid plate, or the hatch flange on it.
    top = H + (2 * f if enc.hatches else f)
    assert y1 * mm == pytest.approx(top, abs=1e-3)


def test_rotation_maps_ports_and_holes():
    esp = load_part("C-001")
    p = Placement(esp, (0.0, 0.0), 90, 0.0)
    w, d, _ = esp.size
    assert p.footprint == (d, w)
    [uart, _] = p.ports()
    assert uart.side == "-y"
    assert uart.u == pytest.approx(d - esp.ports[0].u)

    bme = load_part("P-001")
    q = Placement(bme, (10.0, 20.0), 90, 0.0)
    fw, fd = q.footprint
    for x, y, _ in q.holes():
        assert 10.0 <= x <= 10.0 + fw and 20.0 <= y <= 20.0 + fd


def test_validate_rejects_crowding_and_unreachable_ports():
    layout = load_layout(LAYOUTS[0])
    esp, tp = layout.placements[0], layout.placements[1]
    layout.placements[1] = Placement(tp.part, (tp.at[0], esp.box[4] + 0.5), tp.rot, tp.z0)
    layout.placements[0] = Placement(esp.part, (5.0, esp.at[1]), esp.rot, esp.z0)
    errors = layout.validate()
    assert any("gap" in e for e in errors)
    assert any("usb-c-uart" in e for e in errors)


def test_validate_rejects_gland_behind_a_part():
    layout = load_layout(LAYOUTS[0])
    # On the -x wall at y = 12 the cable would run straight into the ESP32-S3.
    layout.glands = [Gland("-x", 12.0, 8.0, load_part("P-002"))]
    assert any("blocks the cable path" in e for e in layout.validate())


def test_lint_flags_flat_overhang_and_floating_body():
    shelf = cq.Workplane("XY").box(10, 10, 10, centered=False).union(
        cq.Workplane("XY").box(20, 10, 2, centered=False).translate((0, 0, 10))
    )
    checks = lint_mesh(_mesh(shelf, [1, 1, 1, 1]), PROFILE)
    assert not checks["overhang"]["ok"]
    assert checks["on_bed"]["ok"]

    floating = cq.Workplane("XY").box(10, 10, 10, centered=False).translate((0, 0, 5))
    assert not lint_mesh(_mesh(floating, [1, 1, 1, 1]), PROFILE)["on_bed"]["ok"]


def test_lint_flags_loose_pieces():
    a = cq.Workplane("XY").box(10, 10, 10, centered=False)
    b = cq.Workplane("XY").box(10, 10, 10, centered=False).translate((20, 0, 0))
    checks = lint_mesh(_mesh(a.union(b), [1, 1, 1, 1]), PROFILE)
    assert checks["watertight"]["ok"]
    assert not checks["single_body"]["ok"]


def test_port_openings_stay_below_lid_lip(built):
    layout, _ = built
    pc = layout.profile["port_clearance_mm"]
    ch = layout.cavity()[2]
    for p in layout.placements:
        for port in p.ports():
            hw, hh = port.opening(pc)
            assert p.z0 + port.v + hh + hw <= ch + 1e-9, f"{p.part.id}.{port.name}"


def test_coupons_are_valid_and_pass_lint(tmp_path):
    for name, body in build_coupons(PROFILE).items():
        assert len(body.solids().vals()) == 1, name
        assert body.val().isValid(), name
    report = export_coupons(PROFILE, tmp_path)
    assert report["passed"], {k: v for k, v in report["bodies"].items() if not passed(v)}


def test_every_part_file_loads():
    for path in sorted((ROOT / "parts").glob("*.json")):
        part = load_part(path.stem)
        assert all(s > 0 for s in part.size)


def test_root_is_the_spike_dir():
    assert ROOT == Path(__file__).resolve().parent.parent
