"""Base, lid and battery hatches for a layout, in CadQuery.

World frame: the base's outer min corner is the origin; the cavity origin sits at
(wall, wall, floor). The lid and hatches are modelled in their assembled position;
`print_lid` and `print_orient` turn them for printing.

Every downward-facing surface, as printed, is either on the bed or at 45°, so the
overhang lint passes by construction: port cuts get a 45° roof, the gland hole is a
teardrop, and raised lid features point up when the lid prints plate-down.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import cadquery as cq
import segno

from .model import Gland, Layout, Placement, Port

POST_ARM_MM = 5.0
POST_HEIGHT_MM = 4.0
HATCH_FLANGE_MM = 3.0
HATCH_NOTCH_MM = (12.0, 2.0)  # width, depth into the flange
QR_MODULE_MM = 1.0  # 2.5 extrusion widths at 0.4 mm
QR_RAISE_MM = 0.6
QR_QUIET_MODULES = 2
QR_INSET_MM = 0.05  # per side; far below what a 0.4 mm nozzle resolves


@dataclass
class QR:
    serial: str
    x: float  # world min corner of the code on the inner lid face
    y: float
    matrix: list[list[int]]


@dataclass
class Enclosure:
    base: cq.Workplane
    lid: cq.Workplane  # assembled position
    ghosts: list[tuple[str, cq.Workplane]]  # part bounding boxes, for the viewer
    outer: tuple[float, float, float]  # base outer size (W, D, H)
    hatches: list[tuple[str, cq.Workplane]] = field(default_factory=list)  # assembled
    qr: QR | None = None


def build(layout: Layout, serial: str | None = None) -> Enclosure:
    pr = layout.profile
    t, f = pr["wall_mm"], pr["floor_mm"]
    cw, cd, ch = layout.cavity()
    # Headroom for the lid lip, which reaches down into the cavity.
    W, D, H = cw + 2 * t, cd + 2 * t, f + ch + pr["lid_lip_mm"]

    base = _box(0, W, 0, D, 0, H).cut(_box(t, t + cw, t, t + cd, f, H + 1))
    for p in layout.placements:
        kind = p.part.mount["type"]
        if kind == "cradle":
            if p.z0 > 0:
                # Raised so its plug openings clear the floor: a pedestal carries it.
                fx0, fy0, fx1, fy1 = _footprint(p, t)
                base = base.union(_box(fx0, fx1, fy0, fy1, f, f + p.z0))
            base = base.union(_cradle_posts(p, pr, t, f))
        elif kind == "pcb-standoff":
            base = _standoffs(base, p, pr, t, f)
        else:
            raise ValueError(f"{p.part.id}: mount {kind!r} can't be placed inside")
    # Cuts go last so nothing added later fills them in.
    for p in layout.placements:
        for port in p.ports():
            base = base.cut(_port_cut(p, port, pr, t, f, cw, cd))
    for g in layout.glands:
        base = base.cut(_gland_cut(g, pr, t, f, cw, cd))

    ghosts = [
        (
            p.part.id,
            _box(
                t + p.box[0], t + p.box[3], t + p.box[1], t + p.box[4], f + p.box[2], f + p.box[5]
            ),
        )
        for p in layout.placements
    ]

    lid = _lid(layout, pr, W, D, H)
    lid, hatches, openings = _battery_hatches(layout, pr, lid, H)
    keepouts = openings + [_footprint(p, t) for p in layout.placements if p.part.exposure == "vent"]
    serial = serial or f"AF-{layout.name}".upper()
    lid, qr = _emboss_qr(layout, pr, lid, H, serial, keepouts)
    return Enclosure(base, lid, ghosts, (W, D, H), hatches, qr)


def print_lid(enc: Enclosure, profile: dict) -> cq.Workplane:
    """The lid turned plate-down, min corner at the origin."""
    W, D, H = enc.outer
    return enc.lid.rotate((0, 0, 0), (1, 0, 0), 180).translate((0, D, H + profile["floor_mm"]))


def print_orient(shape: cq.Workplane) -> cq.Workplane:
    """Turn an assembled lid-side body over (its top face onto the bed), min corner at the origin."""
    flipped = shape.rotate((0, 0, 0), (1, 0, 0), 180)
    bb = flipped.val().BoundingBox()
    return flipped.translate((-bb.xmin, -bb.ymin, -bb.zmin))


def _box(x0, x1, y0, y1, z0, z1) -> cq.Workplane:
    xa, xb = sorted((x0, x1))
    ya, yb = sorted((y0, y1))
    za, zb = sorted((z0, z1))
    return cq.Workplane("XY").box(xb - xa, yb - ya, zb - za, centered=False).translate((xa, ya, za))


def _footprint(p: Placement, t: float) -> tuple[float, float, float, float]:
    """A part's plan rectangle in world coords."""
    return (t + p.box[0], t + p.box[1], t + p.box[3], t + p.box[4])


def _plan_overlap(a, b) -> bool:
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def _cradle_posts(p: Placement, pr: dict, t: float, f: float) -> cq.Workplane:
    """An L-shaped post outside each corner of the footprint."""
    cc, m = pr["cradle_clearance_mm"], pr["lint"]["min_wall_mm"]
    bx = p.box
    x0, y0, x1, y1 = t + bx[0] - cc, t + bx[1] - cc, t + bx[3] + cc, t + bx[4] + cc
    h = min(POST_HEIGHT_MM, p.part.size[2])
    posts = None
    for cx, sx in ((x0, -1), (x1, 1)):
        for cy, sy in ((y0, -1), (y1, 1)):
            arm_x = _box(cx - sx * POST_ARM_MM, cx + sx * m, cy, cy + sy * m, f, f + p.z0 + h)
            arm_y = _box(cx, cx + sx * m, cy - sy * POST_ARM_MM, cy + sy * m, f, f + p.z0 + h)
            corner = arm_x.union(arm_y)
            posts = corner if posts is None else posts.union(corner)
    return posts


def _standoffs(base: cq.Workplane, p: Placement, pr: dict, t: float, f: float) -> cq.Workplane:
    sh, od = p.z0, pr["standoff_od_mm"]
    tap = pr["self_tap_hole_d_mm"][p.part.mount["screw"]]
    floor = pilot_floor_mm(pr)
    for hx, hy, _ in p.holes():
        x, y = t + hx, t + hy
        post = cq.Workplane("XY").circle(od / 2).extrude(sh).translate((x, y, f))
        base = base.union(post)
        # Blind pilot hole, leaving the minimum wall of floor under it.
        pilot = cq.Workplane("XY").circle(tap / 2).extrude(f + sh - floor).translate((x, y, floor))
        base = base.cut(pilot)
    return base


def pilot_floor_mm(pr: dict) -> float:
    """Floor left under a standoff's blind pilot hole."""
    return pr["lint"]["min_wall_mm"]


def _wall_plane(side: str, t: float, cw: float, cd: float) -> cq.Plane:
    """A plane 1 mm beyond one face of the wall, for cutting through it.

    Local x is the world coordinate along the wall, local y is world z, and the
    normal points through the wall, so extruding wall + 2 mm clears both faces.
    """
    if side == "-x":
        return cq.Plane(origin=(-1, 0, 0), xDir=(0, 1, 0), normal=(1, 0, 0))
    if side == "+x":
        return cq.Plane(origin=(t + cw - 1, 0, 0), xDir=(0, 1, 0), normal=(1, 0, 0))
    if side == "-y":
        return cq.Plane(origin=(0, t + 1, 0), xDir=(1, 0, 0), normal=(0, -1, 0))
    if side == "+y":
        return cq.Plane(origin=(0, cd + 2 * t + 1, 0), xDir=(1, 0, 0), normal=(0, -1, 0))
    raise ValueError(side)


def roofed_rect(a: float, b: float, hw: float, hh: float) -> list[tuple[float, float]]:
    """A rectangle centred on (a, b) with a 45° roof, so it has no flat ceiling."""
    return [(a - hw, b - hh), (a + hw, b - hh), (a + hw, b + hh), (a, b + hh + hw), (a - hw, b + hh)]


def teardrop(a: float, b: float, r: float, n: int = 36) -> list[tuple[float, float]]:
    """A circle centred on (a, b) whose top is a 45° point, so it has no flat ceiling."""
    pts = []
    for i in range(n + 1):
        th = math.radians(135 + 270 * i / n)
        pts.append((a + r * math.cos(th), b + r * math.sin(th)))
    pts.append((a, b + r * math.sqrt(2)))
    return pts


def _port_cut(p: Placement, port: Port, pr, t, f, cw, cd) -> cq.Workplane:
    pc = pr["port_clearance_mm"]
    along = p.at[1] if port.side in ("-x", "+x") else p.at[0]
    a, b = t + along + port.u, f + p.z0 + port.v
    pts = roofed_rect(a, b, *port.opening(pc))
    return cq.Workplane(_wall_plane(port.side, t, cw, cd)).polyline(pts).close().extrude(t + 2)


def _gland_cut(g: Gland, pr, t, f, cw, cd) -> cq.Workplane:
    r = g.part.mount["d_mm"] / 2 + pr["gland_clearance_mm"]
    pts = teardrop(t + g.u, f + g.v, r)
    return cq.Workplane(_wall_plane(g.side, t, cw, cd)).polyline(pts).close().extrude(t + 2)


def _lid_interior(layout: Layout, pr: dict) -> tuple[float, float, float, float]:
    """The plan rectangle inside the lid's lip ring, in world coords."""
    t = pr["wall_mm"]
    cw, cd, _ = layout.cavity()
    k = pr["lid_lip_clearance_mm"] + pr["lint"]["min_wall_mm"]
    return (t + k, t + k, t + cw - k, t + cd - k)


def _lid(layout: Layout, pr: dict, W: float, D: float, H: float) -> cq.Workplane:
    t, f = pr["wall_mm"], pr["floor_mm"]
    cw, cd, _ = layout.cavity()
    lc, lip, m = pr["lid_lip_clearance_mm"], pr["lid_lip_mm"], pr["lint"]["min_wall_mm"]

    lid = _box(0, W, 0, D, H, H + f)
    ring = _box(t + lc, t + cw - lc, t + lc, t + cd - lc, H - lip, H).cut(
        _box(t + lc + m, t + cw - lc - m, t + lc + m, t + cd - lc - m, H - lip - 1, H + 1)
    )
    lid = lid.union(ring)

    sw, sl = pr["vent_slot_mm"]
    pitch = pr["vent_pitch_mm"]
    for p in layout.placements:
        if p.part.exposure != "vent":
            continue
        fw, fd = p.footprint
        length = min(sl, fd - 2)
        cy = t + p.at[1] + fd / 2
        n = max(1, int((fw - 2) // pitch))
        x_start = t + p.at[0] + (fw - (n - 1) * pitch) / 2
        for i in range(n):
            cx = x_start + i * pitch
            lid = lid.cut(_box(cx - sw / 2, cx + sw / 2, cy - length / 2, cy + length / 2, H - 0.1, H + f + 0.1))
    return lid


def _battery_hatches(layout: Layout, pr: dict, lid: cq.Workplane, H: float):
    """A tool-free hatch over each battery part: an opening in the lid, and a separate
    hatch with a friction plug, a flange resting on the lid's outer face and a finger
    notch in the flange. Returns the cut lid, the hatches and their plan keepouts."""
    t, f, c = pr["wall_mm"], pr["floor_mm"], pr["lid_lip_clearance_mm"]
    x0i, y0i, x1i, y1i = _lid_interior(layout, pr)
    hatches, keepouts = [], []
    for p in layout.placements:
        if "battery" not in p.part.flags:
            continue
        fx0, fy0, fx1, fy1 = _footprint(p, t)
        # Over the part, but inside the lip ring so the ring stays attached all round.
        ox0, oy0 = max(fx0 + 1, x0i + 0.5), max(fy0 + 1, y0i + 0.5)
        ox1, oy1 = min(fx1 - 1, x1i - 0.5), min(fy1 - 1, y1i - 0.5)
        lid = lid.cut(_box(ox0, ox1, oy0, oy1, H - 0.1, H + f + 0.1))

        fl = HATCH_FLANGE_MM
        plug = _box(ox0 + c, ox1 - c, oy0 + c, oy1 - c, H, H + f)
        flange = _box(ox0 - fl, ox1 + fl, oy0 - fl, oy1 + fl, H + f, H + 2 * f)
        nw, nd = HATCH_NOTCH_MM
        cx = (ox0 + ox1) / 2
        notch = _box(cx - nw / 2, cx + nw / 2, oy1 + fl - nd, oy1 + fl + 1, H + f - 0.1, H + 2 * f + 0.1)
        hatches.append((p.part.id, plug.union(flange).cut(notch)))
        keepouts.append((ox0, oy0, ox1, oy1))
    return lid, hatches, keepouts


def _emboss_qr(layout: Layout, pr: dict, lid: cq.Workplane, H: float, serial: str, keepouts):
    """The build serial as a QR code raised on the lid's inner face (ARCHITECTURE.md §7.4).

    Columns are mirrored so that, with the lid turned over, the code reads rotated
    rather than mirrored; scanners handle rotation.
    """
    matrix = [list(row) for row in segno.make(serial, error="m", micro=False, boost_error=False).matrix]
    n, m = len(matrix), QR_MODULE_MM
    size, quiet = n * m, QR_QUIET_MODULES * m
    x0i, y0i, x1i, y1i = _lid_interior(layout, pr)
    candidates = [
        (x0i + quiet, y0i + quiet),
        (x1i - quiet - size, y0i + quiet),
        (x0i + quiet, y1i - quiet - size),
        (x1i - quiet - size, y1i - quiet - size),
    ]
    for qx, qy in candidates:
        zone = (qx - quiet, qy - quiet, qx + size + quiet, qy + size + quiet)
        inside = zone[0] >= x0i - 1e-9 and zone[1] >= y0i - 1e-9 and zone[2] <= x1i + 1e-9 and zone[3] <= y1i + 1e-9
        if inside and not any(_plan_overlap(zone, k) for k in keepouts):
            break
    else:
        raise ValueError(f"{layout.name}: no corner of the lid has room for a {size:.0f} mm QR code")

    shapes = []
    for r, row in enumerate(matrix):
        y = qy + (n - 1 - r) * m
        c = 0
        while c < n:
            if not row[c]:
                c += 1
                continue
            start = c
            while c < n and row[c]:
                c += 1
            # Mirrored columns: module `start..c-1` spans x from the far end. Inset so
            # modules touching only at a corner don't share an edge, which would make
            # the mesh non-manifold; each run is held by the plate it overlaps.
            xa, xb = qx + (n - c) * m + QR_INSET_MM, qx + (n - start) * m - QR_INSET_MM
            ya, yb = y + QR_INSET_MM, y + m - QR_INSET_MM
            shapes.append(_box(xa, xb, ya, yb, H - QR_RAISE_MM, H + 0.1).val())
    raised = shapes[0].fuse(*shapes[1:]).clean() if len(shapes) > 1 else shapes[0]
    lid = lid.union(cq.Workplane("XY").newObject([raised]))
    return lid, QR(serial, qx, qy, matrix)
