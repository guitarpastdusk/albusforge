"""uv run python -m fit build layouts/*.json [--printer all|id,id] [--out out]
uv run python -m fit coupons [--printer all|id,id] [--out out]

Output goes to out/<printer>/<layout>/ and out/<printer>/coupons/.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .coupons import export_coupons
from .enclosure import build
from .export import export
from .model import list_printers, load_layout, load_printer


def _printers(arg: str) -> list[str]:
    known = list_printers()
    if arg == "all":
        return known
    chosen = arg.split(",")
    unknown = [p for p in chosen if p not in known]
    if unknown:
        raise SystemExit(f"unknown printer(s) {unknown}; known: {known}")
    return chosen


def _build(args) -> bool:
    ok = True
    for printer_id in _printers(args.printer):
        for path in args.layouts:
            layout = load_layout(path, printer_id)
            label = f"{printer_id}/{layout.name}"
            errors = layout.validate()
            if errors:
                print(f"{label}: invalid layout")
                for e in errors:
                    print(f"  - {e}")
                ok = False
                continue
            report = export(layout, build(layout), Path(args.out) / printer_id)
            print(f"{label}: {'PASS' if report['passed'] else 'FAIL'}  outer {report['outer_mm']} mm")
            for section in ("params", *report["bodies"]):
                for name, check in report[section].items():
                    if not check["ok"]:
                        print(f"  {section}.{name}: {check['detail']}")
            ok = ok and report["passed"]
    return ok


def _coupons(args) -> bool:
    ok = True
    for printer_id in _printers(args.printer):
        report = export_coupons(load_printer(printer_id), Path(args.out) / printer_id)
        failed = {n: c for n, c in report["bodies"].items() if not all(x["ok"] for x in c.values())}
        print(f"{printer_id}/coupons: {'PASS' if not failed else 'FAIL ' + str(sorted(failed))}")
        ok = ok and report["passed"]
    return ok


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="fit")
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build", help="build, export and lint layouts for each printer")
    b.add_argument("layouts", nargs="+")
    b.add_argument("--printer", default="all")
    b.add_argument("--out", default="out")
    c = sub.add_parser("coupons", help="export the tolerance coupons for each printer")
    c.add_argument("--printer", default="all")
    c.add_argument("--out", default="out")
    args = ap.parse_args(argv)
    ok = _build(args) if args.cmd == "build" else _coupons(args)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
