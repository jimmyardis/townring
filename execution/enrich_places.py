#!/usr/bin/env python3
"""
TownRing — add population to the places GeoJSON.

The places files carry only a name and a boundary, so get_place_info could
answer "what is the population of Chapin town?" with a name and nothing else.
The voice agent then fell back to whatever number was in its system prompt —
which was the 24-tract Greater Chapin figure, so "Chapin" came back as 96,000
people instead of about 1,800.

This fetches place-level population straight from the Census API (which, unlike
TIGERweb, is reachable) and joins it onto each place by GEOID.

Usage:
  python execution/enrich_places.py                 # all four cities
  python execution/enrich_places.py --city chapin

Adds to each place's properties:
  pop_2020_dec, pop_2010_dec, growth_pct_2010_2020, pop_<year> for 2014-2024
"""

import argparse, json, os, sys, time
from pathlib import Path

import requests

CENSUS = "https://api.census.gov/data"
STATE = "45"
ACS_YEARS = list(range(2014, 2025))
CITIES = ["chapin", "charleston", "columbia", "sumter"]


def get(url, params, retries=3):
    for i in range(retries):
        try:
            r = requests.get(url, params=params, timeout=60)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            if i == retries - 1:
                print(f"  ! {e}")
                return None
            time.sleep(2)


def fetch_acs_places(year, key):
    """{place_geoid: population} for every SC place in one ACS vintage."""
    rows = get(f"{CENSUS}/{year}/acs/acs5", {
        "get": "B01003_001E", "for": "place:*", "in": f"state:{STATE}", "key": key})
    if not rows:
        return {}
    out = {}
    for r in rows[1:]:
        pop, st, place = r[0], r[-2], r[-1]
        try:
            v = int(pop)
        except (TypeError, ValueError):
            continue
        if v >= 0:
            out[st + place] = v
    return out


def fetch_decennial_places(key):
    """(2020, 2010) dicts of {place_geoid: population}."""
    out = {}
    for year, var, path in [(2020, "P1_001N", "dec/pl"), (2010, "P001001", "dec/sf1")]:
        rows = get(f"{CENSUS}/{year}/{path}", {
            "get": var, "for": "place:*", "in": f"state:{STATE}", "key": key})
        d = {}
        if rows:
            for r in rows[1:]:
                try:
                    d[r[-2] + r[-1]] = int(r[0])
                except (TypeError, ValueError):
                    pass
        out[year] = d
        print(f"  decennial {year}: {len(d)} places")
    return out[2020], out[2010]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--city", action="append", help="limit to one city (repeatable)")
    ap.add_argument("--key", default=os.environ.get("CENSUS_API_KEY", ""))
    args = ap.parse_args()
    if not args.key:
        sys.exit("ERROR: Census API key required (--key or CENSUS_API_KEY)")

    targets = args.city or CITIES

    print("Fetching SC place populations from the Census API...")
    acs = {}
    for y in ACS_YEARS:
        acs[y] = fetch_acs_places(y, args.key)
        print(f"  ACS {y}: {len(acs[y])} places")
    dec2020, dec2010 = fetch_decennial_places(args.key)

    for slug in targets:
        path = Path(slug) / "data" / f"{slug}-places.geojson"
        if not path.exists():
            print(f"\n{slug}: no places file, skipping")
            continue
        gj = json.loads(path.read_text())
        hit = 0
        for f in gj["features"]:
            geoid = f["properties"].get("GEOID")
            if not geoid:
                continue
            p20, p10 = dec2020.get(geoid), dec2010.get(geoid)
            if p20 is not None:
                f["properties"]["pop_2020_dec"] = p20
                hit += 1
            if p10 is not None:
                f["properties"]["pop_2010_dec"] = p10
            if p20 and p10:
                f["properties"]["growth_pct_2010_2020"] = round((p20 - p10) / p10 * 100, 1)
            for y in ACS_YEARS:
                v = acs.get(y, {}).get(geoid)
                if v is not None:
                    f["properties"][f"pop_{y}"] = v
        path.write_text(json.dumps(gj, separators=(",", ":")))
        print(f"\n{slug}: {hit}/{len(gj['features'])} places got population -> {path}")
        for f in gj["features"][:6]:
            pr = f["properties"]
            print(f"   {pr.get('display_name','?'):28} 2020={pr.get('pop_2020_dec','n/a'):>8} "
                  f"2024={pr.get('pop_2024','n/a'):>8}")


if __name__ == "__main__":
    main()
