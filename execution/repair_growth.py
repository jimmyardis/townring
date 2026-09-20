#!/usr/bin/env python3
"""
TownRing — recompute per-tract growth from the populations actually stored.

Every city's tracts carried a `growth_pct` that disagreed with its own
`pop_2010` and `pop_2020`: 13 of 14 comparable Chapin tracts, 133 of 134 in
Charleston, and every comparable tract in Sumter. Some had the wrong sign —
Sumter tract 16 read -17.5% where the stored counts give +7.3%.

The stored counts are decennial and authoritative, so `growth_pct` and
`growth_abs` are derived, not inputs. This recomputes them in place. It needs
no network, so it works while TIGERweb is blocked.

Corrupts nothing if run twice.

Usage:
  python execution/repair_growth.py             # all cities, writes
  python execution/repair_growth.py --check     # report only
"""

import argparse, json
from pathlib import Path

CITIES = ["chapin", "charleston", "columbia", "sumter"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="report without writing")
    ap.add_argument("--city", action="append")
    args = ap.parse_args()

    for slug in (args.city or CITIES):
        path = Path(slug) / "data" / f"{slug}-area-tracts.geojson"
        if not path.exists():
            print(f"{slug}: no tracts file, skipping")
            continue

        gj = json.loads(path.read_text())
        fixed = cleared = comparable = 0

        for f in gj["features"]:
            p = f["properties"]
            a, b = p.get("pop_2010"), p.get("pop_2020")

            if not a or b is None:
                # No 2010 count: the tract's boundary changed, so growth is
                # undefined. Leave it null rather than implying a number.
                if p.get("growth_pct") is not None or p.get("growth_abs") is not None:
                    p["growth_pct"] = None
                    p["growth_abs"] = None
                    cleared += 1
                continue

            comparable += 1
            pct = round((b - a) / a * 100, 1)
            abs_ = b - a
            if p.get("growth_pct") != pct or p.get("growth_abs") != abs_:
                p["growth_pct"] = pct
                p["growth_abs"] = abs_
                fixed += 1

        verb = "would fix" if args.check else "fixed"
        print(f"{slug}: {verb} {fixed}/{comparable} comparable tracts"
              + (f", cleared {cleared} with no 2010 count" if cleared else ""))

        if not args.check and (fixed or cleared):
            path.write_text(json.dumps(gj, separators=(",", ":")))


if __name__ == "__main__":
    main()
