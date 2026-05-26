"""
TownRing Census Pipeline  v2
Fetches tract geometries + demographics for any SC city and writes the four
data files a TownRing city page needs:

  {slug}/data/{slug}-area-tracts.geojson
  {slug}/data/{slug}-places.geojson
  {slug}/data/{slug}-cinematic-shapes.geojson
  {slug}/data/{slug}-area-summary.json

Multi-county cities (Charleston, Chapin) are supported via the config.

Usage:
  python execution/fetch_census.py --config execution/cities/charleston.json \\
      --key YOUR_CENSUS_API_KEY

  # or set env var:
  CENSUS_API_KEY=... python execution/fetch_census.py --config ...

Census API key (free, instant): https://api.census.gov/data/key_signup.html
"""

import argparse, json, math, os, sys, time
from pathlib import Path

import requests
from shapely.geometry import shape, mapping, Polygon, box
from shapely.ops import unary_union

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
TIGER_BASE  = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb"
CENSUS_BASE = "https://api.census.gov/data"

# ACS 5-year years for the year slider (update max year when new vintage ships)
ACS_YEARS = list(range(2014, 2024))   # 2014–2023

# Year-built bucket midpoints for B25034_002E … B25034_011E
YEAR_BUILT_MIDPOINTS = [2022, 2015, 2005, 1995, 1985, 1975, 1965, 1955, 1945, 1930]

# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

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


def safe_int(v, fallback=None):
    try:
        n = int(v)
        return n if n >= 0 else fallback
    except (TypeError, ValueError):
        return fallback


def safe_float(v, fallback=None):
    try:
        f = float(v)
        return f if f >= 0 else fallback
    except (TypeError, ValueError):
        return fallback


# ---------------------------------------------------------------------------
# TIGERweb geometry helpers
# ---------------------------------------------------------------------------

def esri_rings_to_shapely(rings):
    if not rings:
        return None
    try:
        return Polygon(rings[0], rings[1:] if len(rings) > 1 else [])
    except Exception:
        return None


def esri_feature_to_geojson(feat):
    geom = feat.get("geometry", {})
    rings = geom.get("rings") or geom.get("curveRings")
    if not rings:
        return None
    poly = esri_rings_to_shapely(rings)
    if poly is None or poly.is_empty:
        return None
    return {"type": "Feature", "geometry": mapping(poly), "properties": feat.get("attributes", {})}


# ---------------------------------------------------------------------------
# Census fetchers
# ---------------------------------------------------------------------------

def fetch_tiger_tracts(state_fips, county_fips):
    url = f"{TIGER_BASE}/Tracts_Blocks/MapServer/0/query"
    geoid_prefix = f"{state_fips}{county_fips}"
    data = get_json(url, {
        "where": f"GEOID LIKE '{geoid_prefix}%'",
        "outFields": "GEOID,NAME,TRACT,STATE,COUNTY,AREALAND,AREAWATER,BASENAME",
        "returnGeometry": "true",
        "f": "geojson",
        "outSR": "4326",
    })
    feats = data.get("features", [])
    print(f"  TIGERweb tracts ({county_fips}): {len(feats)}")
    return feats


def fetch_decennial(state_fips, county_fips, key):
    results = {}

    # 2020 decennial (P1 — race/ethnicity table)
    try:
        data = get_json(f"{CENSUS_BASE}/2020/dec/pl", {
            "get": "P1_001N,P1_003N",
            "for": "tract:*",
            "in": f"state:{state_fips} county:{county_fips}",
            "key": key,
        })
        hdr = data[0]
        for row in data[1:]:
            r = dict(zip(hdr, row))
            geoid = state_fips + county_fips + r["tract"]
            total = safe_int(r.get("P1_001N"), 0)
            white = safe_int(r.get("P1_003N"), 0)
            results.setdefault(geoid, {})
            results[geoid]["pop_2020_dec"] = total
            results[geoid]["pct_nonwhite"] = (
                round((total - white) / total * 100, 1) if total else None
            )
    except Exception as e:
        print(f"  Warning: 2020 decennial failed: {e}")

    # 2010 decennial (SF1)
    try:
        data = get_json(f"{CENSUS_BASE}/2010/dec/sf1", {
            "get": "P001001",
            "for": "tract:*",
            "in": f"state:{state_fips} county:{county_fips}",
            "key": key,
        })
        hdr = data[0]
        for row in data[1:]:
            r = dict(zip(hdr, row))
            geoid = state_fips + county_fips + r["tract"]
            results.setdefault(geoid, {})
            results[geoid]["pop_2010"] = safe_int(r.get("P001001"))
            results[geoid]["has_2010"] = True
    except Exception as e:
        print(f"  Warning: 2010 decennial failed: {e}")

    print(f"  Decennial ({county_fips}): {len(results)} tracts")
    return results


def fetch_acs_demographics(state_fips, county_fips, key, year=2023):
    """
    Pull demographic + housing snapshot from ACS 5-year {year}.
    Returns dict keyed by GEOID.
    """
    variables = ",".join([
        "B01003_001E",   # total population
        "B19013_001E",   # median household income
        "B01002_001E",   # median age
        "B25077_001E",   # median home value
        "B25064_001E",   # median gross rent
        "B17001_002E",   # below poverty line (count)
        "B17001_001E",   # poverty universe
        "B15003_022E",   # bachelor's degree
        "B15003_023E",   # master's degree
        "B15003_024E",   # professional degree
        "B15003_025E",   # doctorate
        "B15003_001E",   # education universe
        "B23025_005E",   # unemployed
        "B23025_003E",   # labor force
        "B08301_001E",   # commute total
        "B08301_021E",   # work from home
    ])
    try:
        data = get_json(f"{CENSUS_BASE}/{year}/acs/acs5", {
            "get": variables,
            "for": "tract:*",
            "in": f"state:{state_fips} county:{county_fips}",
            "key": key,
        })
        hdr = data[0]
        results = {}
        for row in data[1:]:
            r = dict(zip(hdr, row))
            geoid = state_fips + county_fips + r["tract"]

            pop        = safe_int(r["B01003_001E"])
            income     = safe_int(r["B19013_001E"])
            age        = safe_float(r["B01002_001E"])
            home_val   = safe_int(r["B25077_001E"])
            rent       = safe_int(r["B25064_001E"])
            pov_cnt    = safe_int(r["B17001_002E"], 0)
            pov_uni    = safe_int(r["B17001_001E"], 0)
            ba_cnt     = sum(safe_int(r[f"B15003_0{n}E"], 0) for n in ["22","23","24","25"])
            edu_uni    = safe_int(r["B15003_001E"], 0)
            unemp      = safe_int(r["B23025_005E"], 0)
            labor      = safe_int(r["B23025_003E"], 0)
            commute    = safe_int(r["B08301_001E"], 0)
            wfh        = safe_int(r["B08301_021E"], 0)

            results[geoid] = {
                "median_income":    income if income and income > 0 else None,
                "median_age":       age if age and age > 0 else None,
                "median_home_value": home_val if home_val and home_val > 0 else None,
                "median_gross_rent": rent if rent and rent > 0 else None,
                "poverty_rate":     round(pov_cnt / pov_uni * 100, 1) if pov_uni else None,
                "pct_bachelors_plus": round(ba_cnt / edu_uni * 100, 1) if edu_uni else None,
                "unemployment_rate": round(unemp / labor * 100, 1) if labor else None,
                "pct_wfh":          round(wfh / commute * 100, 1) if commute else None,
            }
        print(f"  ACS {year} demographics ({county_fips}): {len(results)} tracts")
        return results
    except Exception as e:
        print(f"  Warning: ACS demographics failed: {e}")
        return {}


def fetch_acs_housing(state_fips, county_fips, key, year=2023):
    """
    Pull housing stock variables from ACS 5-year {year}.
    Includes occupancy, tenure, unit type, and year-built (weighted avg).
    """
    variables = ",".join([
        "B25001_001E",   # total housing units
        "B25002_002E",   # occupied
        "B25002_003E",   # vacant
        "B25003_001E",   # tenure total
        "B25003_002E",   # owner-occupied
        "B25024_001E",   # units in structure total
        "B25024_002E",   # 1-unit detached
        "B25024_003E",   # 1-unit attached
        # Year built buckets (002=2020+, 003=2010-19, ... 011=1939 or earlier)
        "B25034_001E","B25034_002E","B25034_003E","B25034_004E","B25034_005E",
        "B25034_006E","B25034_007E","B25034_008E","B25034_009E","B25034_010E",
        "B25034_011E",
    ])
    try:
        data = get_json(f"{CENSUS_BASE}/{year}/acs/acs5", {
            "get": variables,
            "for": "tract:*",
            "in": f"state:{state_fips} county:{county_fips}",
            "key": key,
        })
        hdr = data[0]
        results = {}
        for row in data[1:]:
            r = dict(zip(hdr, row))
            geoid = state_fips + county_fips + r["tract"]

            total_units = safe_int(r["B25001_001E"], 0)
            occupied    = safe_int(r["B25002_002E"], 0)
            vacant      = safe_int(r["B25002_003E"], 0)
            tenure_tot  = safe_int(r["B25003_001E"], 0)
            owner_occ   = safe_int(r["B25003_002E"], 0)
            struct_tot  = safe_int(r["B25024_001E"], 0)
            sf_det      = safe_int(r["B25024_002E"], 0)
            sf_att      = safe_int(r["B25024_003E"], 0)

            # Weighted average year built from decade buckets (B25034_002E … B25034_011E)
            yr_counts = [safe_int(r.get(f"B25034_{str(i).zfill(3)}E"), 0) for i in range(2, 12)]
            yr_total = sum(yr_counts)
            yr_built = None
            if yr_total > 0:
                yr_built = round(
                    sum(c * m for c, m in zip(yr_counts, YEAR_BUILT_MIDPOINTS)) / yr_total
                )

            results[geoid] = {
                "total_housing_units": total_units if total_units else None,
                "vacancy_rate":        round(vacant / total_units * 100, 1) if total_units else None,
                "owner_occ_rate":      round(owner_occ / tenure_tot * 100, 1) if tenure_tot else None,
                "pct_single_family":   round((sf_det + sf_att) / struct_tot * 100, 1) if struct_tot else None,
                "median_year_built":   yr_built,
            }
        print(f"  ACS {year} housing ({county_fips}): {len(results)} tracts")
        return results
    except Exception as e:
        print(f"  Warning: ACS housing failed: {e}")
        return {}


def fetch_acs_annual_pop(state_fips, county_fips, key):
    """Annual ACS 5-year population for tract year slider."""
    results = {}
    for year in ACS_YEARS:
        try:
            data = get_json(f"{CENSUS_BASE}/{year}/acs/acs5", {
                "get": "B01003_001E",
                "for": "tract:*",
                "in": f"state:{state_fips} county:{county_fips}",
                "key": key,
            })
            hdr = data[0]
            for row in data[1:]:
                r = dict(zip(hdr, row))
                geoid = state_fips + county_fips + r["tract"]
                results.setdefault(geoid, {})[f"pop_{year}"] = safe_int(r["B01003_001E"])
            print(f"  ACS {year}: ok")
        except Exception as e:
            print(f"  ACS {year}: failed ({e})")
        time.sleep(0.3)
    return results


def fetch_county_annual_pop(state_fips, county_fips, county_name, key):
    """County-level ACS 5-year annual population for summary JSON."""
    results = {}
    for year in ACS_YEARS:
        try:
            data = get_json(f"{CENSUS_BASE}/{year}/acs/acs5", {
                "get": "B01003_001E",
                "for": f"county:{county_fips}",
                "in": f"state:{state_fips}",
                "key": key,
            })
            r = dict(zip(data[0], data[1]))
            results[str(year)] = safe_int(r.get("B01003_001E"))
        except Exception as e:
            print(f"  County ACS {year}: failed ({e})")
        time.sleep(0.2)
    print(f"  County annual pop ({county_name}): {len(results)} years")
    return results


def fetch_places(state_fips, county_fips_list, tract_union):
    url = f"{TIGER_BASE}/Places_CouSub_ConCity_SubMCD/MapServer/4/query"
    data = get_json(url, {
        "where": f"STATE='{state_fips}'",
        "outFields": "GEOID,NAME,BASENAME,LSADC",
        "returnGeometry": "true",
        "f": "json",
        "outSR": "4326",
    })
    features = data.get("features", [])
    print(f"  TIGERweb places (statewide): {len(features)}")

    LSAD_CODES = {"25": "city", "43": "town", "47": "village",
                  "36": "CDP", "57": "borough", "62": "city", "00": "place"}
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


def make_cinematic_shapes(union_geom, slug):
    world_box = box(-180, -85, 180, 85)
    inverted = world_box.difference(union_geom)
    return [
        {"type": "Feature", "geometry": mapping(union_geom),
         "properties": {"kind": f"greater_{slug}_union"}},
        {"type": "Feature", "geometry": mapping(inverted),
         "properties": {"kind": "inverted_mask"}},
    ]


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--key", default=os.environ.get("CENSUS_API_KEY", ""))
    parser.add_argument("--radius", type=float, default=25.0,
                        help="km radius for 'greater area' tagging")
    parser.add_argument("--demo-year", type=int, default=2023,
                        help="ACS 5-year vintage for snapshot demographics (default 2023)")
    args = parser.parse_args()

    if not args.key:
        sys.exit("ERROR: Census API key required (--key or CENSUS_API_KEY env var)")

    cfg = json.loads(Path(args.config).read_text())
    city       = cfg["city"]
    state_fp   = cfg["fips_state"]
    center     = (cfg["center_lng"], cfg["center_lat"])
    slug       = city.lower().replace(" ", "-")

    # Multi-county support: fips_county can be a string or list
    raw_counties = cfg["fips_county"]
    if isinstance(raw_counties, str):
        raw_counties = [raw_counties]
    # county_names maps FIPS → display name; falls back to cfg["county"] for single-county
    county_names_map = cfg.get("county_names", {})
    if not county_names_map:
        county_names_map = {raw_counties[0]: cfg.get("county", city)}

    out_dir = Path(slug) / "data"
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n=== TownRing Census Pipeline v2: {city}, SC ===")
    print(f"Counties: {raw_counties}")
    print(f"ACS snapshot year: {args.demo_year}")
    print(f"Annual slider: {ACS_YEARS[0]}–{ACS_YEARS[-1]}")
    print(f"Output: {out_dir}/\n")

    # -----------------------------------------------------------------------
    # Per-county data collection
    # -----------------------------------------------------------------------
    all_tiger_feats    = []
    all_dec_data       = {}
    all_demo_data      = {}
    all_housing_data   = {}
    all_annual_pop     = {}
    county_annual_pops = {}   # county_name → {year: pop}

    for county_fp in raw_counties:
        county_name = county_names_map.get(county_fp, county_fp)
        print(f"\n--- County: {county_name} ({county_fp}) ---")

        print("  Fetching tract geometries...")
        feats = fetch_tiger_tracts(state_fp, county_fp)
        # Tag each feature with its county name
        for f in feats:
            f.setdefault("properties", {})["_county_name"] = county_name
        all_tiger_feats.extend(feats)

        print("  Fetching decennial 2010/2020...")
        all_dec_data.update(fetch_decennial(state_fp, county_fp, args.key))

        print(f"  Fetching ACS {args.demo_year} demographics...")
        all_demo_data.update(fetch_acs_demographics(state_fp, county_fp, args.key, args.demo_year))

        print(f"  Fetching ACS {args.demo_year} housing...")
        all_housing_data.update(fetch_acs_housing(state_fp, county_fp, args.key, args.demo_year))

        print(f"  Fetching annual population {ACS_YEARS[0]}–{ACS_YEARS[-1]}...")
        all_annual_pop.update(fetch_acs_annual_pop(state_fp, county_fp, args.key))

        print(f"  Fetching county-level annual population...")
        county_annual_pops[county_name] = fetch_county_annual_pop(
            state_fp, county_fp, county_name, args.key
        )

    # -----------------------------------------------------------------------
    # Assemble tracts GeoJSON
    # -----------------------------------------------------------------------
    print("\n=== Assembling tracts GeoJSON ===")

    def haversine_km(lon1, lat1, lon2, lat2):
        R = 6371.0
        phi1, phi2 = math.radians(lat1), math.radians(lat2)
        a = (math.sin((phi2 - phi1) / 2) ** 2
             + math.cos(phi1) * math.cos(phi2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2)
        return 2 * R * math.asin(math.sqrt(a))

    tract_features = []
    tract_shapes   = []

    for feat in all_tiger_feats:
        geoid = feat["properties"].get("GEOID", "")
        if not geoid:
            continue
        geom = shape(feat["geometry"]) if feat.get("geometry") else None
        if geom is None or geom.is_empty:
            continue

        try:
            cen = geom.centroid
            dist_km = haversine_km(center[0], center[1], cen.x, cen.y)
        except Exception:
            dist_km = 999

        land_m2 = int(feat["properties"].get("AREALAND") or 0)
        aland_sqkm = round(land_m2 / 1_000_000, 4) if land_m2 else None

        county_name = feat["properties"].get("_county_name", "")

        dec  = all_dec_data.get(geoid, {})
        demo = all_demo_data.get(geoid, {})
        hous = all_housing_data.get(geoid, {})
        ann  = all_annual_pop.get(geoid, {})

        # Population: prefer ACS 5-year latest for pop_2020 consistency with year slider;
        # keep decennial pop_2020_dec as reference
        pop_2020 = dec.get("pop_2020_dec")
        pop_2010 = dec.get("pop_2010")
        growth_pct = None
        growth_abs = None
        if pop_2010 and pop_2020 and pop_2010 > 0:
            growth_pct = round((pop_2020 - pop_2010) / pop_2010 * 100, 1)
            growth_abs = pop_2020 - pop_2010

        density = None
        if aland_sqkm and pop_2020:
            density = round(pop_2020 / aland_sqkm, 1)

        props = {
            # Identifiers
            "GEOID":       geoid,
            "TRACT":       feat["properties"].get("TRACT", ""),
            "NAME":        feat["properties"].get("NAME", ""),
            "county_name": county_name,
            "aland_sqkm":  aland_sqkm,
            "is_greater_area": dist_km <= args.radius,
            # Decennial population
            "pop_2020":    pop_2020,
            "pop_2010":    pop_2010,
            "has_2010":    bool(pop_2010),
            "growth_pct":  growth_pct,
            "growth_abs":  growth_abs,
            # Derived
            "density_per_sqkm": density,
            "pct_nonwhite":     dec.get("pct_nonwhite"),
            # ACS demographics snapshot
            "median_income":      demo.get("median_income"),
            "median_age":         demo.get("median_age"),
            "median_home_value":  demo.get("median_home_value"),
            "median_gross_rent":  demo.get("median_gross_rent"),
            "poverty_rate":       demo.get("poverty_rate"),
            "pct_bachelors_plus": demo.get("pct_bachelors_plus"),
            "unemployment_rate":  demo.get("unemployment_rate"),
            "pct_wfh":            demo.get("pct_wfh"),
            # ACS housing snapshot
            "total_housing_units": hous.get("total_housing_units"),
            "vacancy_rate":        hous.get("vacancy_rate"),
            "owner_occ_rate":      hous.get("owner_occ_rate"),
            "pct_single_family":   hous.get("pct_single_family"),
            "median_year_built":   hous.get("median_year_built"),
        }
        # Annual population for year slider
        props.update(ann)

        tract_features.append({
            "type": "Feature",
            "geometry": mapping(geom),
            "properties": props,
        })
        tract_shapes.append(geom)

    path_tracts = out_dir / f"{slug}-area-tracts.geojson"
    path_tracts.write_text(json.dumps(
        {"type": "FeatureCollection", "features": tract_features},
        separators=(",", ":")
    ))
    print(f"Wrote {len(tract_features)} tracts → {path_tracts}")

    # -----------------------------------------------------------------------
    # Tract union → places + cinematic shapes
    # -----------------------------------------------------------------------
    print("\n=== Building derived outputs ===")
    tract_union = unary_union(tract_shapes)

    place_feats = fetch_places(state_fp, raw_counties, tract_union)
    places_gj   = {"type": "FeatureCollection", "features": place_feats}
    path_places = out_dir / f"{slug}-places.geojson"
    path_places.write_text(json.dumps(places_gj, separators=(",", ":")))
    print(f"Wrote {len(place_feats)} places → {path_places}")

    cin_feats = make_cinematic_shapes(tract_union, slug)
    cin_gj    = {"type": "FeatureCollection", "features": cin_feats}
    path_cin  = out_dir / f"{slug}-cinematic-shapes.geojson"
    path_cin.write_text(json.dumps(cin_gj, separators=(",", ":")))
    print(f"Wrote cinematic shapes → {path_cin}")

    # -----------------------------------------------------------------------
    # Summary JSON
    # -----------------------------------------------------------------------
    print("\n=== Writing summary ===")
    pop_2020_total = sum(f["properties"].get("pop_2020") or 0 for f in tract_features)
    pop_2010_total = sum(f["properties"].get("pop_2010") or 0 for f in tract_features)

    summary = {
        "city":        city,
        "state":       "SC",
        "county":      county_names_map.get(raw_counties[0], cfg.get("county", city)),
        "counties":    list(county_names_map.values()),
        "fips_state":  state_fp,
        "fips_county": raw_counties,
        "center":      {"lng": center[0], "lat": center[1]},
        "acs_vintage": args.demo_year,
        "total_tracts": len(tract_features),
        "pop_2020":    pop_2020_total,
        "pop_2010":    pop_2010_total,
        "growth_pct_2010_2020": (
            round((pop_2020_total - pop_2010_total) / pop_2010_total * 100, 1)
            if pop_2010_total else None
        ),
        "county_population_by_year": county_annual_pops,
    }
    path_summary = out_dir / f"{slug}-area-summary.json"
    path_summary.write_text(json.dumps(summary, indent=2))
    print(f"Wrote summary → {path_summary}")

    # -----------------------------------------------------------------------
    # Done
    # -----------------------------------------------------------------------
    print(f"\n=== Done: {city} ===")
    for f in sorted(out_dir.iterdir()):
        print(f"  {f.name}: {f.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
