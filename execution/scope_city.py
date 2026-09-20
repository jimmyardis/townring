#!/usr/bin/env python3
"""
TownRing — derive a radius-scoped city from an already-built city.

Two TownRing configs that list the same counties produce byte-identical data,
because fetch_census.py pulls whole counties. A town inside a metro (Chapin
inside the Columbia metro) needs the same tracts clipped to a radius around its
own center. This script does that clip offline, reusing geometry already on
disk, so it does not depend on TIGERweb.

Usage:
  python execution/scope_city.py --from columbia --config execution/cities/chapin.json

Reads   {from}/data/{from}-area-tracts.geojson
        {from}/data/{from}-places.geojson
        {from}/data/{from}-area-summary.json
Writes  {slug}/data/{slug}-area-tracts.geojson
        {slug}/data/{slug}-places.geojson
        {slug}/data/{slug}-cinematic-shapes.geojson
        {slug}/data/{slug}-area-summary.json

The source city must be a superset: same state, and its county list must cover
every county the scoped city should contain.
"""

import argparse, json, math, sys
from pathlib import Path

from shapely.geometry import shape, mapping, box
from shapely.ops import unary_union

ACS_YEARS = list(range(2014, 2025))


def haversine_km(lon1, lat1, lon2, lat2):
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    a = (math.sin((phi2 - phi1) / 2) ** 2
         + math.cos(phi1) * math.cos(phi2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2)
    return 2 * R * math.asin(math.sqrt(a))


def make_cinematic_shapes(union_geom, slug):
    world_box = box(-180, -85, 180, 85)
    inverted = world_box.difference(union_geom)
    return [
        {"type": "Feature", "geometry": mapping(union_geom),
         "properties": {"kind": f"greater_{slug}_union"}},
        {"type": "Feature", "geometry": mapping(inverted),
         "properties": {"kind": "inverted_mask"}},
    ]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="source", required=True,
                    help="slug of the already-built city to clip from, e.g. columbia")
    ap.add_argument("--config", required=True,
                    help="config of the city to produce; must set radius_km")
    ap.add_argument("--radius", type=float, default=None,
                    help="override radius_km from the config")
    args = ap.parse_args()

    cfg = json.loads(Path(args.config).read_text())
    city = cfg["city"]
    slug = city.lower().replace(" ", "-")
    center = (cfg["center_lng"], cfg["center_lat"])
    radius_km = args.radius if args.radius is not None else cfg.get("radius_km")
    if radius_km is None:
        sys.exit(f"ERROR: {args.config} has no radius_km and --radius was not given. "
                 "A scoped city needs a radius; use fetch_census.py for whole-county builds.")

    src = args.source
    src_dir = Path(src) / "data"
    out_dir = Path(slug) / "data"
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n=== TownRing scope: {city} from {src} ===")
    print(f"Center: {center[0]}, {center[1]}   Radius: {radius_km} km")

    tracts = json.loads((src_dir / f"{src}-area-tracts.geojson").read_text())
    places = json.loads((src_dir / f"{src}-places.geojson").read_text())
    src_summary = json.loads((src_dir / f"{src}-area-summary.json").read_text())

    # --- tracts: keep those whose centroid is inside the radius ------------
    kept, shapes = [], []
    for f in tracts["features"]:
        geom = shape(f["geometry"])
        if geom.is_empty:
            continue
        cen = geom.centroid
        if haversine_km(center[0], center[1], cen.x, cen.y) > radius_km:
            continue
        f["properties"]["is_greater_area"] = True
        kept.append(f)
        shapes.append(geom)

    if not kept:
        sys.exit(f"ERROR: no tracts within {radius_km} km of {center}. Wrong center or source city?")

    (out_dir / f"{slug}-area-tracts.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": kept}, separators=(",", ":")))
    print(f"Tracts: {len(tracts['features'])} → {len(kept)}")

    # --- places + cinematic shapes derived from the clipped union ----------
    union = unary_union(shapes)
    kept_places = [p for p in places["features"] if shape(p["geometry"]).intersects(union)]
    (out_dir / f"{slug}-places.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": kept_places}, separators=(",", ":")))
    print(f"Places: {len(places['features'])} → {len(kept_places)}  "
          f"({', '.join(sorted(p['properties'].get('display_name', '?') for p in kept_places)[:8])}…)")

    (out_dir / f"{slug}-cinematic-shapes.geojson").write_text(
        json.dumps({"type": "FeatureCollection",
                    "features": make_cinematic_shapes(union, slug)}, separators=(",", ":")))
    print("Cinematic shapes: rebuilt from clipped union")

    # --- summary ----------------------------------------------------------
    def total(field):
        return sum(f["properties"].get(field) or 0 for f in kept)

    pop_2020, pop_2010 = total("pop_2020"), total("pop_2010")
    counties_present = sorted({f["properties"].get("county_name") for f in kept if f["properties"].get("county_name")})

    # Tracts whose boundaries changed have no 2010 count. Summing all tracts'
    # 2020 population against only the ones that existed in 2010 invents growth
    # (Columbia read 52% that way; like-for-like it is 4.7%), so compare only
    # tracts that carry both numbers.
    comparable = [f["properties"] for f in kept
                  if f["properties"].get("pop_2010") and f["properties"].get("pop_2020")]
    cmp_2010 = sum(p["pop_2010"] for p in comparable)
    cmp_2020 = sum(p["pop_2020"] for p in comparable)
    growth_pct = round((cmp_2020 - cmp_2010) / cmp_2010 * 100, 1) if cmp_2010 else None

    # County totals stay county-wide (the voice agent answers county questions
    # with them); area_population_by_year is the scoped city's own series.
    summary = {
        "city": city,
        "state": cfg.get("state", "SC"),
        "county": cfg.get("county", counties_present[0] if counties_present else city),
        "counties": counties_present,
        "fips_state": cfg["fips_state"],
        "fips_county": cfg["fips_county"] if isinstance(cfg["fips_county"], list) else [cfg["fips_county"]],
        "center": {"lng": center[0], "lat": center[1]},
        "acs_vintage": src_summary.get("acs_vintage"),
        "radius_km": radius_km,
        "scoped_from": src,
        "total_tracts": len(kept),
        "pop_2020": pop_2020,
        "pop_2010": pop_2010,
        "growth_pct_2010_2020": growth_pct,
        "growth_basis": {
            "comparable_tracts": len(comparable),
            "total_tracts": len(kept),
            "pop_2010": cmp_2010,
            "pop_2020": cmp_2020,
            "note": ("Growth compares only tracts reporting both 2010 and 2020 counts; "
                     f"{len(kept) - len(comparable)} tracts had boundary changes and are excluded."),
        },
        "area_population_by_year": {str(y): total(f"pop_{y}") for y in ACS_YEARS},
        "county_population_by_year": {
            c: v for c, v in (src_summary.get("county_population_by_year") or {}).items()
            if c in counties_present
        },
    }
    (out_dir / f"{slug}-area-summary.json").write_text(json.dumps(summary, indent=2))
    print(f"Summary: {len(kept)} tracts, pop_2020 {pop_2020:,} (was {src_summary.get('pop_2020'):,})")
    print(f"Counties: {', '.join(counties_present)}")
    print(f"\nWrote 4 files → {out_dir}/\n")


if __name__ == "__main__":
    main()
