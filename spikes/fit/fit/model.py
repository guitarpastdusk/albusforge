"""Parts, tolerance profiles and layouts, loaded from JSON and validated.

Coordinates: the cavity origin is the inner floor's min corner, x right, y back,
z up. A placement's `at` is the min corner of the part's footprint after rotation.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SIDES = ("-x", "+x", "-y", "+y")
# Where each side lands after a 90° counter-clockwise turn about z.
ROT90_SIDE = {"-x": "-y", "+y": "-x", "+x": "+y", "-y": "+x"}


@dataclass(frozen=True)
class Port:
    name: str
    side: str
    u: float  # centre along the side, from the side's min end
    v: float  # centre height, from the part's bottom
    w: float
    h: float
    # The mating plug's outline (w, h). Its overmold has to reach the receptacle
    # through the wall, so when given it sizes the opening.
    plug: tuple[float, float] | None = None

    def opening(self, clearance: float) -> tuple[float, float]:
        """Half-width and half-height of the wall cut, before its 45° roof."""
        w, h = self.w, self.h
        if self.plug:
            w, h = max(w, self.plug[0]), max(h, self.plug[1])
        return w / 2 + clearance, h / 2 + clearance


@dataclass(frozen=True)
class Part:
    id: str
    name: str
    size: tuple[float, float, float]
    mount: dict
    exposure: str
    flags: tuple[str, ...]
    holes: tuple[tuple[float, float, float], ...]  # (x, y, d) in part coords
    ports: tuple[Port, ...]


@dataclass(frozen=True)
class Placement:
    part: Part
    at: tuple[float, float]
    rot: int  # 0 or 90
    z0: float  # height of the part's bottom above the floor

    @property
    def footprint(self) -> tuple[float, float]:
        w, d, _ = self.part.size
        return (w, d) if self.rot == 0 else (d, w)

    @property
    def box(self) -> tuple[float, float, float, float, float, float]:
        """(x0, y0, z0, x1, y1, z1) in cavity coords."""
        fw, fd = self.footprint
        x, y = self.at
        return (x, y, self.z0, x + fw, y + fd, self.z0 + self.part.size[2])

    def holes(self) -> list[tuple[float, float, float]]:
        """Mounting holes in cavity coords."""
        out = []
        for hx, hy, d in self.part.holes:
            lx, ly = (hx, hy) if self.rot == 0 else (self.part.size[1] - hy, hx)
            out.append((self.at[0] + lx, self.at[1] + ly, d))
        return out

    def ports(self) -> list[Port]:
        """Ports with side and u in cavity terms (u still relative to the part)."""
        if self.rot == 0:
            return list(self.part.ports)
        w, d, _ = self.part.size
        out = []
        for p in self.part.ports:
            side = ROT90_SIDE[p.side]
            # x-sides run along y (length d) and become y-sides running along x,
            # mirrored; y-sides run along x (length w) and keep their direction.
            u = (d - p.u) if p.side in ("-x", "+x") else p.u
            out.append(Port(p.name, side, u, p.v, p.w, p.h, p.plug))
        return out


@dataclass(frozen=True)
class Gland:
    side: str
    u: float  # centre along the wall, cavity coords
    v: float  # centre height above the floor
    part: Part


@dataclass
class Layout:
    name: str
    profile: dict
    placements: list[Placement]
    glands: list[Gland] = field(default_factory=list)

    def cavity(self) -> tuple[float, float, float]:
        c = self.profile["part_clearance_mm"]
        xs = max(p.box[3] for p in self.placements) + c
        ys = max(p.box[4] for p in self.placements) + c
        tops = [p.box[5] + c for p in self.placements]
        pc = self.profile["port_clearance_mm"]
        for p in self.placements:
            for port in p.ports():
                hw, hh = port.opening(pc)
                # The whole opening, roof included, stays below the lid lip: the
                # lip ring sits just inside the wall, where the plug goes. A roof
                # through the wall top would also cut loose a sliver of wall.
                tops.append(p.z0 + port.v + hh + hw)
        return (round(xs, 3), round(ys, 3), round(max(tops), 3))

    def validate(self) -> list[str]:
        errors: list[str] = []
        c = self.profile["part_clearance_mm"]
        cw, cd, ch = self.cavity()
        eps = 1e-6
        for p in self.placements:
            x0, y0, _, x1, y1, _ = p.box
            if x0 < c - eps or y0 < c - eps:
                errors.append(f"{p.part.id}: closer than {c} mm to the -x or -y wall")
            for port in p.ports():
                flush = {
                    "-x": x0 - c,
                    "+x": cw - c - x1,
                    "-y": y0 - c,
                    "+y": cd - c - y1,
                }[port.side]
                if abs(flush) > eps:
                    errors.append(
                        f"{p.part.id}.{port.name}: part must sit at clearance from the"
                        f" {port.side} wall to reach it (off by {flush:.2f} mm)"
                    )
        for i, a in enumerate(self.placements):
            for b in self.placements[i + 1 :]:
                gap = _gap(a.box, b.box)
                need = keepout(a, self.profile) + keepout(b, self.profile)
                if gap < need - eps:
                    errors.append(f"{a.part.id} and {b.part.id}: gap {gap:.2f} mm < {need:.2f} mm")
        for g in self.glands:
            span = cw if g.side in ("-y", "+y") else cd
            r = g.part.mount["d_mm"] / 2 + self.profile["gland_clearance_mm"]
            # The teardrop's point is r·√2 above its centre and must stay below the lid lip.
            if not (r <= g.u <= span - r and r <= g.v and g.v + r * math.sqrt(2) <= ch):
                errors.append(f"gland for {g.part.id} does not fit on the {g.side} wall")
            corridor = _gland_corridor(g, r, cw, cd)
            for p in self.placements:
                if _overlaps(corridor, p.box):
                    errors.append(
                        f"gland for {g.part.id} on {g.side}: {p.part.id} blocks the cable path"
                    )
        return errors


# The probe and its cable go straight in through the gland before they can bend.
GLAND_CORRIDOR_MM = 8.0


def _gland_corridor(g: Gland, r: float, cw: float, cd: float) -> tuple[float, ...]:
    """The box the cable passes through just inside the wall, in cavity coords."""
    k = GLAND_CORRIDOR_MM
    z0, z1 = g.v - r, g.v + r
    if g.side == "-x":
        return (0.0, g.u - r, z0, k, g.u + r, z1)
    if g.side == "+x":
        return (cw - k, g.u - r, z0, cw, g.u + r, z1)
    if g.side == "-y":
        return (g.u - r, 0.0, z0, g.u + r, k, z1)
    return (g.u - r, cd - k, z0, g.u + r, cd, z1)


def _overlaps(a, b) -> bool:
    return all(a[i] < b[i + 3] and b[i] < a[i + 3] for i in range(3))


def keepout(p: Placement, profile: dict) -> float:
    """Space a part claims around its footprint toward a neighbour.

    Cradle parts are located by corner posts one minimum wall thick, outside the
    cradle clearance. Against the enclosure walls the posts merge into the wall,
    so the wall rule stays the plain part clearance.
    """
    if p.part.mount["type"] == "cradle":
        return profile["cradle_clearance_mm"] + profile["lint"]["min_wall_mm"]
    return profile["part_clearance_mm"]


def _gap(a, b) -> float:
    """Largest axis separation between two boxes in plan; negative if they overlap."""
    return max(b[0] - a[3], a[0] - b[3], b[1] - a[4], a[1] - b[4])


def load_part(part_id: str) -> Part:
    d = json.loads((ROOT / "parts" / f"{part_id}.json").read_text())
    m, ext = d["mechanical"], d.get("spike_ext", {})
    ports = tuple(
        Port(
            p["name"],
            p["side"],
            p["center"][0],
            p["center"][1],
            p["size"][0],
            p["size"][1],
            tuple(p["plug"]) if "plug" in p else None,
        )
        for p in ext.get("ports", [])
    )
    for p in ports:
        if p.side not in SIDES:
            raise ValueError(f"{part_id}.{p.name}: side {p.side!r} not one of {SIDES}")
    return Part(
        id=d["id"],
        name=d["name"],
        size=tuple(m["bounding_mm"]),
        mount=m["mount"],
        exposure=m["exposure"],
        flags=tuple(m.get("environment_flags", [])),
        holes=tuple(tuple(h) for h in ext.get("holes", [])),
        ports=ports,
    )


def load_profile(name: str) -> dict:
    """A tolerance table on its own, without a printer."""
    return json.loads((ROOT / "tolerances" / f"{name}.json").read_text())


def list_printers() -> list[str]:
    return sorted(p.stem for p in (ROOT / "printers").glob("*.json"))


DEFAULT_PRINTER = "bambu-a1"


def load_printer(printer_id: str) -> dict:
    """The tolerance table a printer prints with: the shared table, its overrides, its bed.

    Every printer starts from a shared table. Coupons printed on that printer replace
    values through `overrides` (top-level keys, replaced whole) and bump `version`.
    """
    printer = json.loads((ROOT / "printers" / f"{printer_id}.json").read_text())
    profile = load_profile(printer["tolerances"])
    profile.update(printer.get("overrides", {}))
    profile["profile"] = f"{printer_id}+{printer['tolerances']}"
    profile["version"] = f"{profile['version']}.{printer.get('version', 0)}"
    profile["printer"] = {
        "id": printer["id"],
        "name": printer["name"],
        "kinematics": printer["kinematics"],
        "enclosed": printer["enclosed"],
        "nozzle_mm": printer["nozzle_mm"],
        "calibrated": printer["calibrated"],
        "bed_mm": printer["build_volume_mm"],
    }
    return profile


def load_layout(path: str | Path, printer_id: str = DEFAULT_PRINTER) -> Layout:
    d = json.loads(Path(path).read_text())
    profile = load_printer(printer_id)
    placements = []
    for item in d["parts"]:
        part = load_part(item["part"])
        rot = item.get("rot", 0)
        if rot not in (0, 90):
            raise ValueError(f"{part.id}: rot must be 0 or 90")
        z0 = profile["standoff_height_mm"] if part.mount["type"] == "pcb-standoff" else 0.0
        placements.append(Placement(part, tuple(item["at"]), rot, z0))
    glands = [
        Gland(g["side"], g["u"], g["v"], load_part(g["part"])) for g in d.get("glands", [])
    ]
    return Layout(d["name"], profile, placements, glands)
