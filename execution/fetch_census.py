"""
TownRing Census Pipeline
Fetches tract geometries + demographics for any SC county and writes
the four data files a TownRing city page needs:
  {city}/data/{slug}-area-tracts.geojson
  {city}/data/{slug}-places.geojson
  {city}/data/{slug}-cinematic-shapes.geojson
  {city}/data/{slug}-area-summary.json

Usage:
  python execution/fetch_census.py --config execution/cities/columbia.json \
      --key YOUR_CENSUS_API_KEY

Census API key (free): https://api.census.gov/data/key_signup.html
"""

import argparse, json, math, os, sys, time
from pathlib import Path

import requests
from shapely.geometry import (
    shape, mapping, Point, Polygon, MultiPolygon,
    GeometryCollection
)
from shapely.ops import unary_union

# ---------------------------------------------------------------------------
# Census / TIGERweb endpoints
# ---------------------------------------------------------------------------
TIGER_BASE  = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb"
CENSUS_BASE = "https://api.census.gov/data"
ACS_YEARS   = list(range(2014, 2023))   # 2014–2022 for the year slider

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def haversine_km(lon1, lat1, lon2, lat2):
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def get_json(url, params, retries=3):
    for attempt in range(retries):
        try:
            r = requests.get(url, params=params, timeout=60)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            if attempt == retries - 1:
                raise
            print(f"  Retry {attempt+1}: {e}")
            time.sleep(2)


def esri_rings_to_shapely(rings):
    """Convert Esri ring array to Shapely Polygon (first ring = exterior, rest = holes)."""
    if not rings:
        return None
    exterior = rings[0]
    holes = rings[1:] if len(rings) > 1 else []
    try:
        return Polygon(exterior, holes)
    except Exception:
        return None


def esri_feature_to_geojson(feat):
    """Convert an Esri JSON feature to a GeoJSON-style dict."""
    geom = feat.get("geometry", {})
    rings = geom.get("rings") or geom.get("curveRings")
    if not rings:
        return None
    poly = esri_rings_to_shapely(rings)
    if poly is None or poly.is_empty:
        return None
    return {"type": "Feature", "geometry": mapping(poly), "properties": feat.get("attributes", {})}


def fetch_tiger_tracts(state_fips, county_fips):
    """Fetch all census tracts for a county from TIGERweb as GeoJSON features."""
    url = f"{TIGER_BASE}/Tracts_Blocks/MapServer/0/query"
    geoid_prefix = f"{state_fips}{county_fips}"
    params = {
        "where": f"GEOID LIKE '{geoid_prefix}%'",
        "outFields": "GEOID,NAME,TRACT,STATE,COUNTY,AREALAND,AREAWATER",
        "returnGeometry": "true",
        "f": "geojson",
        "outSR": "4326",
    }
    data = get_json(url, params)
    features = data.get("features", [])
    print(f"  TIGERweb tracts: {len(features)} features")
    return features


def fetch_census_decennial(state_fips, county_fips, key):
    """Fetch 2020 and 2010 decennial population for all tracts."""
    results = {}

    # 2020 P1 (race/ethnicity)
    url_2020 = f"{CENSUS_BASE}/2020/dec/pl"
    data = get_json(url_2020, {
        "get": "P1_001N,P1_003N,P1_004N,P1_005N,P1_006N,P1_007N,P1_008N",
        "for": f"tract:*",
        "in": f"state:{state_fips} county:{county_fips}",
        "key": key,
    })
    header = data[0]
    for row in data[1:]:
        r = dict(zip(header, row))
        geoid = state_fips + county_fips + r["tract"]
        total = int(r.get("P1_001N") or 0)
        white_alone = int(r.get("P1_003N") or 0)
        results.setdefault(geoid, {})["pop_2020"] = total
        results[geoid]["pct_nonwhite"] = round((total - white_alone) / total * 100, 1) if total else None

    # 2010 P1
    url_2010 = f"{CENSUS_BASE}/2010/dec/sf1"
    try:
        data = get_json(url_2010, {
            "get": "P001001",
            "for": "tract:*",
            "in": f"state:{state_fips} county:{county_fips}",
            "key": key,
        })
        header = data[0]
        for row in data[1:]:
            r = dict(zip(header, row))
            geoid = state_fips + county_fips + r["tract"]
            results.setdefault(geoid, {})["pop_2010"] = int(r.get("P001001") or 0)
            results[geoid]["has_2010"] = True
    except Exception as e:
        print(f"  Warning: 2010 decennial fetch failed: {e}")

    print(f"  Decennial data: {len(results)} tracts")
    return results


def fetch_acs_income_age(state_fips, county_fips, key):
    """Fetch median income and median age from ACS 5-year 2022."""
    url = f"{CENSUS_BASE}/2022/acs/acs5"
    try:
        data = get_json(url, {
            "get": "B19013_001E,B01002_001E",
            "for": "tract:*",
            "in": f"state:{state_fips} county:{county_fips}",
            "key": key,
        })
        header = data[0]
        results = {}
        for row in data[1:]:
            r = dict(zip(header, row))
            geoid = state_fips + county_fips + r["tract"]
            inc = r.get("B19013_001E")
            age = r.get("B01002_001E")
            results[geoid] = {
                "median_income": int(inc) if inc and int(inc) > 0 else None,
                "median_age":    float(age) if age and float(age) > 0 else None,
            }
        print(f"  ACS income/age: {len(results)} tracts")
        return results
    except Exception as e:
        print(f"  Warning: ACS income/age fetch failed: {e}")
        return {}


def fetch_acs_annual_pop(state_fips, county_fips, key):
    """Fetch annual ACS 5-year population estimates 2014–2022."""
    results = {}
    for year in ACS_YEARS:
        url = f"{CENSUS_BASE}/{year}/acs/acs5"
        try:
            data = get_json(url, {
                "get": "B01003_001E",
                "for": "tract:*",
                "in": f"state:{state_fips} county:{county_fips}",
                "key": key,
            })
            header = data[0]
            for row in data[1:]:
                r = dict(zip(header, row))
                geoid = state_fips + county_fips + r["tract"]
                results.setdefault(geoid, {})[f"pop_{year}"] = int(r.get("B01003_001E") or 0)
            print(f"  ACS {year}: ok")
        except Exception as e:
            print(f"  ACS {year}: failed ({e})")
        time.sleep(0.3)
    return results


def fetch_county_annual_pop(state_fips, county_fips, key):
    """Fetch county-level ACS 5-year annual population 2014–2022."""
    results = {}
    for year in ACS_YEARS:
        url = f"{CENSUS_BASE}/{year}/acs/acs5"
        try:
            data = get_json(url, {
                "get": "B01003_001E",
                "for": f"county:{county_fips}",
                "in": f"state:{state_fips}",
                "key": key,
            })
            header = data[0]
            r = dict(zip(header, data[1]))
            results[year] = int(r.get("B01003_001E") or 0)
        except Exception as e:
            print(f"  County ACS {year}: failed ({e})")
        time.sleep(0.2)
    return results


def fetch_places(state_fips, county_fips, tract_union):
    """Fetch incorporated places and CDPs that intersect the tract union."""
    # Layer 4 = Places (Census Designated Places + Incorporated Places)
    url = f"{TIGER_BASE}/Places_CouSub_ConCity_SubMCD/MapServer/4/query"
    params = {
        "where": f"STATE='{state_fips}'",
        "outFields": "GEOID,NAME,BASENAME,LSADC",
        "returnGeometry": "true",
        "f": "json",
        "outSR": "4326",
    }
    data = get_json(url, params)
    features = data.get("features", [])
    print(f"  TIGERweb places (statewide): {len(features)}")

    LSAD_CODES = {
        "25": "city", "43": "town", "47": "village", "36": "CDP",
        "57": "borough", "62": "city", "00": "place",
    }
    output = []
    for feat in features:
        gj = esri_feature_to_geojson(feat)
        if not gj:
            continue
        geom = shape(gj["geometry"])
        if not geom.intersects(tract_union):
            continue
        props = gj["properties"]
        lsadc = str(props.get("LSADC", "")).strip()
        kind_raw = LSAD_CODES.get(lsadc, "place")
        kind = "incorporated_town" if kind_raw in ("city", "town", "village", "borough") else "cdp"
        name = props.get("NAME") or props.get("BASENAME", "Unknown")
        output.append({
            "type": "Feature",
            "geometry": gj["geometry"],
            "properties": {
                "GEOID": props.get("GEOID"),
                "BASENAME": props.get("BASENAME"),
                "display_name": name,
                "kind": kind,
                "tooltip": f"{name}, SC",
            }
        })

    print(f"  Places after spatial filter: {len(output)}")
    return output


def make_cinematic_shapes(union_geom, cfg):
    """Build union polygon + inverted mask for cinematic mode."""
    from shapely.geometry import box
    world_box = box(-180, -85, 180, 85)
    inverted = world_box.difference(union_geom)

    return [
        {
            "type": "Feature",
            "geometry": mapping(union_geom),
            "properties": {"kind": "greater_" + cfg["city"].lower().replace(" ", "_") + "_union"},
        },
        {
            "type": "Feature",
            "geometry": mapping(inverted),
            "properties": {"kind": "inverted_mask"},
        },
    ]


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="TownRing Census Pipeline")
    parser.add_argument("--config", required=True, help="Path to city config JSON")
    parser.add_argument("--key",    default=os.environ.get("CENSUS_API_KEY", ""),
                        help="Census API key (or set CENSUS_API_KEY env var)")
    parser.add_argument("--radius", type=float, default=25.0,
                        help="km radius for 'greater area' tagging (default 25)")
    args = parser.parse_args()

    if not args.key:
        sys.exit("ERROR: Census API key required. Use --key or set CENSUS_API_KEY env var.")

    cfg = json.loads(Path(args.config).read_text())
    city      = cfg["city"]
    state_fp  = cfg["fips_state"]
    county_fp = cfg["fips_county"]
    center    = (cfg["center_lng"], cfg["center_lat"])
    slug      = city.lower().replace(" ", "-")
    county_name = cfg["county"]

    out_dir = Path(slug) / "data"
    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"\n=== TownRing Census Pipeline: {city}, SC ===")
    print(f"Output: {out_dir}/\n")

    # 1. Tract geometries
    print("Step 1: Fetching tract geometries from TIGERweb...")
    tiger_feats = fetch_tiger_tracts(state_fp, county_fp)

    # 2. Decennial 2010/2020
    print("\nStep 2: Fetching decennial census data...")
    dec_data = fetch_census_decennial(state_fp, county_fp, args.key)

    # 3. ACS income + age
    print("\nStep 3: Fetching ACS income and age...")
    acs_data = fetch_acs_income_age(state_fp, county_fp, args.key)

    # 4. ACS annual population
    print("\nStep 4: Fetching ACS annual population (2014–2022)...")
    annual_pop = fetch_acs_annual_pop(state_fp, county_fp, args.key)

    # 5. Assemble tracts GeoJSON
    print("\nStep 5: Assembling tracts GeoJSON...")
    tract_features = []
    tract_shapes = []

    for feat in tiger_feats:
        geoid = feat["properties"].get("GEOID", "")
        if not geoid:
            continue

        geom = shape(feat["geometry"]) if feat.get("geometry") else None
        if geom is None or geom.is_empty:
            continue

        # Compute centroid for distance tagging
        try:
            cen = geom.centroid
            dist_km = haversine_km(center[0], center[1], cen.x, cen.y)
        except Exception:
            dist_km = 999

        land_area = feat["properties"].get("AREALAND")
        try:
            land_m2 = int(land_area or 0)
        except (TypeError, ValueError):
            land_m2 = 0

        props = {
            "GEOID":    geoid,
            "TRACT":    feat["properties"].get("TRACT", ""),
            "NAME":     feat["properties"].get("NAME", ""),
            "county_name": county_name,
            "AREALAND": land_m2,
            "is_greater_area": dist_km <= args.radius,
        }

        # Merge census data
        d = dec_data.get(geoid, {})
        a = acs_data.get(geoid, {})
        ann = annual_pop.get(geoid, {})

        pop20 = d.get("pop_2020")
        pop10 = d.get("pop_2010")
        growth = None
        if pop10 and pop20 and pop10 > 0:
            growth = round((pop20 - pop10) / pop10 * 100, 1)

        props.update({
            "pop_2020":      pop20,
            "pop_2010":      pop10,
            "has_2010":      bool(pop10),
            "growth_pct":    growth,
            "growth_abs":    (pop20 - pop10) if (pop20 and pop10) else None,
            "median_income": a.get("median_income"),
            "median_age":    a.get("median_age"),
            "pct_nonwhite":  d.get("pct_nonwhite"),
        })
        props.update(ann)

        tract_features.append({
            "type": "Feature",
            "geometry": mapping(geom),
            "properties": props,
        })
        tract_shapes.append(geom)

    tracts_gj = {"type": "FeatureCollection", "features": tract_features}
    path_tracts = out_dir / f"{slug}-area-tracts.geojson"
    path_tracts.write_text(json.dumps(tracts_gj, separators=(",", ":")))
    print(f"  Wrote {len(tract_features)} tracts → {path_tracts}")

    # 6. Build tract union for spatial filtering
    print("\nStep 6: Building tract union...")
    tract_union = unary_union(tract_shapes)
    print(f"  Union area: {tract_union.area:.4f} sq degrees")

    # 7. Places
    print("\nStep 7: Fetching places...")
    place_feats = fetch_places(state_fp, county_fp, tract_union)
    places_gj = {"type": "FeatureCollection", "features": place_feats}
    path_places = out_dir / f"{slug}-places.geojson"
    path_places.write_text(json.dumps(places_gj, separators=(",", ":")))
    print(f"  Wrote {len(place_feats)} places → {path_places}")

    # 8. Cinematic shapes
    print("\nStep 8: Building cinematic shapes...")
    cin_feats = make_cinematic_shapes(tract_union, cfg)
    cin_gj = {"type": "FeatureCollection", "features": cin_feats}
    path_cin = out_dir / f"{slug}-cinematic-shapes.geojson"
    path_cin.write_text(json.dumps(cin_gj, separators=(",", ":")))
    print(f"  Wrote cinematic shapes → {path_cin}")

    # 9. County-level annual pop for summary
    print("\nStep 9: Fetching county annual population for summary...")
    county_annual = fetch_county_annual_pop(state_fp, county_fp, args.key)

    # 10. Summary JSON
    print("\nStep 10: Writing summary...")
    pop20_total = sum(f["properties"].get("pop_2020") or 0 for f in tract_features)
    pop10_total = sum(f["properties"].get("pop_2010") or 0 for f in tract_features)
    greater_tracts = [f for f in tract_features if f["properties"].get("is_greater_area")]

    summary = {
        "city": city,
        "state": "SC",
        "county": county_name,
        "fips_state": state_fp,
        "fips_county": county_fp,
        "center": {"lng": center[0], "lat": center[1]},
        "total_tracts": len(tract_features),
        "greater_area_tracts": len(greater_tracts),
        "pop_2020": pop20_total,
        "pop_2010": pop10_total,
        "growth_pct_2010_2020": round((pop20_total - pop10_total) / pop10_total * 100, 1) if pop10_total else None,
        "county_population_by_year": {county_name: county_annual},
    }
    path_summary = out_dir / f"{slug}-area-summary.json"
    path_summary.write_text(json.dumps(summary, indent=2))
    print(f"  Wrote summary → {path_summary}")

    print(f"\n=== Done. Files in {out_dir}/ ===")
    for f in sorted(out_dir.iterdir()):
        size_kb = f.stat().st_size // 1024
        print(f"  {f.name}: {size_kb} KB")


if __name__ == "__main__":
    main()
