#!/usr/bin/env python3
"""
Urban Productivity Pipeline — Per-acre property-tax analysis for any geography.
Spec: walled_city_pipeline_spec.md by Jimmy Ardis / Carolina Redesign.

Usage:
    python pipeline.py --city Columbia --state SC --county Richland \\
        [--millage 447.4] [--lost-rate 0.0] [--output-dir outputs/columbia_sc] \\
        [--no-dashboard] [--skip-slim]

Supported SC counties: all 46, via SCDOT statewide parcel service.
Charleston and Lexington have dedicated county endpoints with richer schemas.
"""

import argparse
import csv
import json
import math
import os
import sys
from datetime import datetime

import requests
from shapely.geometry import mapping, shape
from shapely.ops import unary_union
from shapely.prepared import prep
from shapely.validation import make_valid

HEADERS = {"User-Agent": "CarolinaRedesign/2.0 (productivitypipeline)"}
TIGER_PLACES = (
    "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb"
    "/Places_CouSub_ConCity_SubMCD/MapServer/4/query"
)

# ──────────────────────────────────────────────────────────────────────────────
# COUNTY REGISTRY
# ──────────────────────────────────────────────────────────────────────────────

SCDOT_BASE = (
    "https://smpesri.scdot.org/arcgis/rest/services"
    "/GISMapping/SC_Parcels/MapServer"
)
SCDOT_LAYER_MAP = {
    "abbeville": 1, "aiken": 2, "allendale": 3, "anderson": 4,
    "bamberg": 5, "barnwell": 6, "beaufort": 7, "berkeley": 8,
    "calhoun": 9, "charleston": 10, "cherokee": 11, "chester": 12,
    "chesterfield": 13, "clarendon": 14, "colleton": 15, "darlington": 16,
    "dillon": 17, "dorchester": 18, "edgefield": 19, "fairfield": 20,
    "florence": 21, "georgetown": 22, "greenville": 23, "greenwood": 24,
    "hampton": 25, "horry": 26, "jasper": 27, "kershaw": 28,
    "lancaster": 29, "laurens": 30, "lee": 31, "lexington": 32,
    "marion": 33, "marlboro": 34, "mccormick": 35, "newberry": 36,
    "oconee": 37, "orangeburg": 38, "pickens": 39, "richland": 40,
    "saluda": 41, "spartanburg": 42, "sumter": 43, "union": 44,
    "williamsburg": 45, "york": 46,
}

# County-specific overrides (richer field schemas than the SCDOT statewide set)
COUNTY_OVERRIDES = {
    "sc:charleston": {
        "rest_url": (
            "https://gisccapps.charlestoncounty.org/arcgis/rest/services"
            "/CDC/CDC_ParcelMap/MapServer/0/query"
        ),
        "adapter": "charleston",
        "millage_default": 313.6,
        "lost_rate": 0.0009,
    },
    "sc:lexington": {
        "rest_url": (
            "https://maps.lex-co.com/agstserver/rest/services"
            "/Property/MapServer/4/query"
        ),
        "adapter": "lexington",
        "millage_default": 461.743,   # unincorporated D5; override for 5C towns
        "lost_rate": 0.0,
    },
}

# Per-district millage table for Charleston County
CHARLESTON_MILLAGE = {
    "7-1": 313.6, "7-2": 313.6, "3-4": 313.6,
    "3-5": 313.6, "3-6": 313.6, "5-2": 313.6,
    "6-3": 313.6, "9-9": 313.6,
}
# Per-district millage for Lexington County
LEXINGTON_MILLAGE = {
    "5C": 551.582,   # Town of Chapin
    "5":  461.743,   # Unincorporated District 5
}


# ──────────────────────────────────────────────────────────────────────────────
# FIELD ADAPTERS  (county → canonical schema)
# ──────────────────────────────────────────────────────────────────────────────

def _safe_float(v, default=0.0):
    try:
        f = float(str(v).replace(",", "").strip())
        return f if math.isfinite(f) else default
    except (TypeError, ValueError):
        return default

def _safe_int(v, default=0):
    try:
        return int(float(str(v).replace(",", "").strip()))
    except (TypeError, ValueError):
        return default


def adapt_charleston(props):
    pid      = str(props.get("PID") or props.get("PARCEL_ID") or "")
    owner    = str(props.get("OWNER1") or "")
    st_no    = str(props.get("PROP_ST_NO") or "").strip()
    st_name  = str(props.get("PROP_ST_NAME") or "").strip()
    address  = f"{st_no} {st_name}".strip()
    lr_raw   = str(props.get("LEGAL_RESIDENCE") or "").upper()
    appraisal = _safe_int(props.get("APPRAISAL"))
    land_appr = _safe_int(props.get("LAND_APPR"))
    imp_appr  = _safe_int(props.get("IMP_APPR"))
    acres     = _safe_float(props.get("ACRES_CAL"))
    class_code = str(props.get("CLASS_CODE") or "")
    tax_dist  = str(props.get("TAX_DISTRICT") or "")
    sale_price = _safe_int(props.get("SALE_PRICE"))
    sale_date  = _epoch_to_date(props.get("DOC_DATE"))
    return {
        "pid": pid, "owner1": owner, "address": address,
        "legal_residence": lr_raw == "Y",
        "appraisal": appraisal, "land_appr": land_appr, "imp_appr": imp_appr,
        "acres_cal": acres, "class_code": class_code, "tax_district": tax_dist,
        "sale_price": sale_price, "doc_date": sale_date,
    }


def adapt_lexington(props):
    pid      = str(props.get("TMS") or "")
    owner    = str(props.get("Owner") or "")
    st_no    = str(props.get("PropAddr_Num") or "").strip()
    st_name  = str(props.get("PropAddr_Str") or "").strip()
    address  = f"{st_no} {st_name}".strip()
    lr_raw   = str(props.get("LR") or "").upper()
    appraisal = _safe_int(props.get("MktTotal"))
    land_appr = _safe_int(props.get("TaxableLand"))
    imp_appr  = _safe_int(props.get("TaxableBldg"))
    acres     = _safe_float(props.get("Acres"))
    class_code = str(props.get("PropTypeCode") or "")
    tax_dist  = str(props.get("TaxDist") or "")
    sale_price = _safe_int(props.get("SalePrice"))
    sale_date  = str(props.get("SaleDate") or "")
    return {
        "pid": pid, "owner1": owner, "address": address,
        "legal_residence": lr_raw == "LR YES",
        "appraisal": appraisal, "land_appr": land_appr, "imp_appr": imp_appr,
        "acres_cal": acres, "class_code": class_code, "tax_district": tax_dist,
        "sale_price": sale_price, "doc_date": sale_date,
    }


def adapt_scdot(props):
    """Generic adapter for SCDOT statewide parcel service (any SC county)."""
    pid      = str(props.get("TMS") or props.get("PIN") or props.get("PARCELNO") or "")
    owner    = str(props.get("OwnerAll") or props.get("NAME1") or "")
    address  = str(props.get("LOC") or "").strip()
    pca      = str(props.get("PCA") or "").strip()
    # PCA is literally the ratio: ".04" or ".06" or other
    lr = pca == ".04"
    appraisal  = _safe_int(props.get("TotalMarket") or props.get("Total_Mkt_"))
    land_appr  = _safe_int(props.get("Market_Land") or props.get("Mkt_Val_La"))
    imp_str    = str(props.get("Mkt_Val_St") or "").strip()
    imp_appr   = _safe_int(imp_str) if imp_str else max(0, appraisal - land_appr)
    acres      = _safe_float(props.get("Acres") or props.get("acreage"))
    tax_dist   = str(props.get("TAXAREA") or props.get("taxDistric") or "")
    exemption1 = str(props.get("Exemption1") or "").strip()
    exemption2 = str(props.get("Exemption2") or "").strip()
    exemption3 = str(props.get("Exemption3") or "").strip()
    zoningcode = str(props.get("ZONINGCODE") or "").strip().upper()
    sale_price = _safe_int(props.get("SALEPRICE") or props.get("taxConside"))
    sale_date  = str(props.get("SALEDATE") or props.get("Date_Modif") or "")
    return {
        "pid": pid, "owner1": owner, "address": address,
        "legal_residence": lr,
        "appraisal": appraisal, "land_appr": land_appr, "imp_appr": imp_appr,
        "acres_cal": acres, "class_code": pca,
        "tax_district": tax_dist,
        "_exemption1": exemption1, "_exemption2": exemption2,
        "_exemption3": exemption3, "_zoningcode": zoningcode,
        "sale_price": sale_price, "doc_date": sale_date,
    }


def _epoch_to_date(ms):
    if ms is None:
        return ""
    try:
        return datetime.utcfromtimestamp(int(ms) / 1000).strftime("%Y-%m-%d")
    except (TypeError, ValueError, OSError):
        return ""


ADAPTERS = {
    "charleston": adapt_charleston,
    "lexington":  adapt_lexington,
    "scdot":      adapt_scdot,
}


# ──────────────────────────────────────────────────────────────────────────────
# USE-GROUP CLASSIFIERS
# ──────────────────────────────────────────────────────────────────────────────

def use_group_charleston(class_code):
    if not class_code:
        return "Other"
    digits = "".join(ch for ch in str(class_code) if ch.isdigit())
    if not digits:
        return "Other"
    ci = int(digits[:3]) if len(digits) >= 3 else int(digits)
    if 100 <= ci < 200: return "Residential"
    if 200 <= ci < 300: return "Specialty / condo"
    if 400 <= ci < 500: return "Parking / ROW"
    if 500 <= ci < 600: return "Commercial"
    if 600 <= ci < 700: return "Office / Specialty"
    if 700 <= ci < 800: return "Institutional / Civic"
    if 900 <= ci < 1000: return "Vacant / Other"
    return "Other"


def use_group_lexington(class_code):
    if not class_code:
        return "Other"
    c = str(class_code).strip()
    if c in ("1", "2", "3"): return "Agricultural / Vacant"
    try:
        ci = int(c)
    except ValueError:
        return "Other"
    if 9000 <= ci <= 9999: return "Institutional / Civic"
    if 1001 <= ci <= 1019: return "Residential"
    if 1020 <= ci <= 1099: return "Residential"
    if 1100 <= ci <= 2999: return "Residential"
    if 4000 <= ci <= 5999: return "Commercial"
    if 6000 <= ci <= 6999: return "Agricultural / Vacant"
    return "Other"


def use_group_scdot(rec):
    """Use group for SCDOT data using PCA + exemption + zoning."""
    exs = [rec.get("_exemption1",""), rec.get("_exemption2",""), rec.get("_exemption3","")]
    if any(e.startswith("EX") for e in exs if e):
        return "Institutional / Civic"
    pca   = str(rec.get("class_code") or "").strip()
    zone  = str(rec.get("_zoningcode") or "").strip().upper()
    appr  = rec.get("appraisal", 0) or 0
    if pca == ".04":
        return "Residential"
    if appr == 0:
        return "Vacant / Other"
    # Zoning-based classification for non-LR parcels
    if zone.startswith(("C", "B", "HC", "GC", "GB", "CC", "CB", "DT", "MX")):
        return "Commercial"
    if zone.startswith(("I", "M", "IN", "IP")):
        return "Office / Specialty"
    if zone in ("AG", "AGR", "AP", "RR", "FR", "RC"):
        return "Vacant / Other"
    # Parking lots are hard to detect without a class code
    return "Residential"


# ──────────────────────────────────────────────────────────────────────────────
# CIVIC / EXEMPT DETECTION
# ──────────────────────────────────────────────────────────────────────────────

def is_civic_exempt_charleston(class_code, appraisal):
    if not class_code:
        return False
    digits = "".join(ch for ch in str(class_code) if ch.isdigit())
    if not digits:
        return False
    ci = int(digits[:3]) if len(digits) >= 3 else int(digits)
    if 670 <= ci <= 720: return True
    if ci == 451: return True
    if appraisal == 0 and 600 <= ci < 800: return True
    return False


def is_civic_exempt_lexington(class_code, appraisal):
    if not class_code:
        return False
    try:
        ci = int(str(class_code).strip())
    except ValueError:
        return False
    if 9000 <= ci <= 9999: return True
    if appraisal == 0 and ci > 8000: return True
    return False


def is_civic_exempt_scdot(rec):
    exs = [rec.get("_exemption1",""), rec.get("_exemption2",""), rec.get("_exemption3","")]
    if any(e.startswith("EX") for e in exs if e):
        return True
    # Also flag zero-appraisal parcels with non-residential PCA as likely exempt
    pca = str(rec.get("class_code") or "").strip()
    appr = rec.get("appraisal", 0) or 0
    if appr == 0 and pca not in (".04", ".06"):
        return True
    return False


# ──────────────────────────────────────────────────────────────────────────────
# BOUNDARY RESOLUTION — CENSUS TIGER PATTERN A
# ──────────────────────────────────────────────────────────────────────────────

def resolve_boundary_tiger(city_name, state_fips):
    """Fetch the incorporated-place polygon from Census TIGERweb."""
    print(f"  → Resolving boundary: TIGER incorporated place '{city_name}' (state {state_fips})")
    params = {
        "where": f"BASENAME='{city_name}' AND STATE='{state_fips}'",
        "outFields": "NAME,GEOID,STATE,PLACE,BASENAME",
        "returnGeometry": "true",
        "outSR": "4326",
        "f": "geojson",
    }
    r = requests.get(TIGER_PLACES, params=params, headers=HEADERS, timeout=60)
    r.raise_for_status()
    gj = r.json()
    feats = gj.get("features", [])
    if not feats:
        raise ValueError(
            f"No TIGER place found for BASENAME='{city_name}' in state {state_fips}. "
            "Try a different spelling or provide coordinates manually."
        )
    if len(feats) > 1:
        print(f"  ⚠  Multiple TIGER matches: {[f['properties'].get('NAME') for f in feats]}")
        print(f"  ⚠  Using first: {feats[0]['properties'].get('NAME')}")
    feat = feats[0]
    geoid = feat["properties"].get("GEOID", "")
    name  = feat["properties"].get("NAME", city_name)
    geom  = shape(feat["geometry"])
    area_acres = geom.area * 247.105   # sq degrees → rough acres at US latitudes
    # More precise: use pyproj or accept the rough estimate
    print(f"  ✓ Found: {name} (GEOID {geoid}), bbox {geom.bounds}")
    return geom, feat["geometry"], name, geoid


def polygon_acres_geodetic(geom):
    """Rough geodetic area in acres using the trapezoid formula."""
    from shapely.ops import transform
    import pyproj
    try:
        proj = pyproj.Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)
        geom_m = transform(proj.transform, geom)
        return geom_m.area * 0.000247105
    except Exception:
        # Fallback: crude degree-to-acre at 34°N
        return geom.area * 111139 * 111139 * math.cos(math.radians(34)) * 0.000247105


# ──────────────────────────────────────────────────────────────────────────────
# GIS ENDPOINT RESOLUTION
# ──────────────────────────────────────────────────────────────────────────────

def resolve_endpoint(state, county):
    """Return (rest_url, adapter_name, millage_default, lost_rate)."""
    key = f"{state.lower()}:{county.lower()}"
    if key in COUNTY_OVERRIDES:
        cfg = COUNTY_OVERRIDES[key]
        return cfg["rest_url"], cfg["adapter"], cfg["millage_default"], cfg["lost_rate"]
    # SCDOT statewide fallback for SC
    if state.upper() == "SC":
        layer_id = SCDOT_LAYER_MAP.get(county.lower())
        if layer_id is None:
            raise ValueError(
                f"County '{county}' not found in SCDOT layer map. "
                "Supported: " + ", ".join(sorted(SCDOT_LAYER_MAP.keys()))
            )
        url = f"{SCDOT_BASE}/{layer_id}/query"
        return url, "scdot", None, 0.0
    raise ValueError(
        f"No endpoint configured for state='{state}', county='{county}'. "
        "Non-SC counties require manual REST URL and adapter configuration."
    )


# ──────────────────────────────────────────────────────────────────────────────
# PARCEL QUERY — PAGINATED POST
# ──────────────────────────────────────────────────────────────────────────────

def _is_html_response(r):
    ct = r.headers.get("Content-Type", "")
    return "html" in ct or r.text.lstrip()[:5].lower() in ("<!doc", "<html")


def query_parcels_bbox(rest_url, bbox, page_size=2000):
    """Query parcels by bounding box. Falls back to WHERE 1=1 if bbox trips WAF."""
    minx, miny, maxx, maxy = bbox
    geometry = {
        "xmin": minx, "ymin": miny, "xmax": maxx, "ymax": maxy,
        "spatialReference": {"wkid": 4326},
    }
    base = {
        "geometry": json.dumps(geometry),
        "geometryType": "esriGeometryEnvelope",
        "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "*",
        "outSR": "4326",
        "f": "geojson",
    }
    # Probe with a tiny result set first to detect WAF block
    probe = {**base, "resultRecordCount": 1, "resultOffset": 0}
    r0 = requests.post(rest_url, data=probe, timeout=60, headers=HEADERS)
    if r0.status_code != 200 or _is_html_response(r0):
        print(f"    ⚠  Bbox query blocked (WAF/HTML response). Falling back to WHERE 1=1 pagination.")
        return query_parcels_where(rest_url, "1=1", page_size)
    all_feats = []
    offset = 0
    while True:
        d = {**base, "resultRecordCount": page_size, "resultOffset": offset}
        r = requests.post(rest_url, data=d, timeout=300, headers=HEADERS)
        if r.status_code != 200 or _is_html_response(r):
            raise RuntimeError(
                f"Query failed at offset {offset}: {r.status_code} {r.text[:300]}"
            )
        page = r.json()
        feats = page.get("features", [])
        all_feats.extend(feats)
        exceeded = page.get("properties", {}).get("exceededTransferLimit", False)
        if len(feats) < page_size and not exceeded:
            break
        offset += page_size
        print(f"    ... paginating: {len(all_feats)} parcels so far (offset {offset})")
        if offset > 500_000:
            raise RuntimeError(f"Safety cap at {offset}")
    return all_feats


def query_parcels_where(rest_url, where_clause, page_size=2000):
    """Paginate all parcels matching a WHERE clause (no geometry filter)."""
    base_params = {
        "where": where_clause,
        "outFields": "*",
        "outSR": "4326",
        "returnGeometry": "true",
        "f": "geojson",
    }
    all_feats = []
    offset = 0
    while True:
        params = {**base_params, "resultRecordCount": page_size, "resultOffset": offset}
        r = requests.get(rest_url, params=params, timeout=300, headers=HEADERS)
        if r.status_code != 200 or _is_html_response(r):
            raise RuntimeError(
                f"WHERE query failed at offset {offset}: {r.status_code} {r.text[:300]}"
            )
        page = r.json()
        feats = page.get("features", [])
        all_feats.extend(feats)
        exceeded = page.get("properties", {}).get("exceededTransferLimit", False)
        if len(feats) < page_size and not exceeded:
            break
        offset += page_size
        if offset % 10000 == 0:
            print(f"    ... paginating: {len(all_feats):,} parcels (offset {offset})")
        if offset > 500_000:
            raise RuntimeError(f"Safety cap at {offset}")
    return all_feats


def query_parcels_polygon(rest_url, coords, page_size=2000):
    """Query parcels with a polygon filter (best for small, simple polygons)."""
    geometry = {"rings": [coords], "spatialReference": {"wkid": 4326}}
    base = {
        "geometry": json.dumps(geometry),
        "geometryType": "esriGeometryPolygon",
        "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "*",
        "outSR": "4326",
        "f": "geojson",
    }
    all_feats = []
    offset = 0
    while True:
        d = {**base, "resultRecordCount": page_size, "resultOffset": offset}
        r = requests.post(rest_url, data=d, timeout=300, headers=HEADERS)
        if r.status_code != 200:
            raise RuntimeError(
                f"Query failed at offset {offset}: {r.status_code} {r.text[:300]}"
            )
        page = r.json()
        feats = page.get("features", [])
        all_feats.extend(feats)
        exceeded = page.get("properties", {}).get("exceededTransferLimit", False)
        if len(feats) < page_size and not exceeded:
            break
        offset += page_size
        print(f"    ... paginating: {len(all_feats)} parcels so far")
        if offset > 500_000:
            raise RuntimeError(f"Safety cap at {offset}")
    return all_feats


# ──────────────────────────────────────────────────────────────────────────────
# GEOMETRY HELPERS
# ──────────────────────────────────────────────────────────────────────────────

def safe_union(geoms):
    valid = []
    bad = 0
    for g in geoms:
        try:
            if not g.is_valid:
                g = make_valid(g)
            if not g.is_valid:
                g = g.buffer(0)
            if g.is_valid and not g.is_empty:
                valid.append(g)
            else:
                bad += 1
        except Exception:
            bad += 1
    if bad:
        print(f"    ⚠  {bad} invalid geometries skipped in union")
    return unary_union(valid) if valid else None


# ──────────────────────────────────────────────────────────────────────────────
# TAX COMPUTATION
# ──────────────────────────────────────────────────────────────────────────────

def compute_tax(rec, millage, lost_rate):
    appr  = rec.get("appraisal", 0) or 0
    ratio = 0.04 if rec.get("legal_residence") else 0.06
    rec["assessment_ratio"] = ratio
    if rec.get("is_civic_exempt") or appr == 0:
        rec["est_tax_gross"] = 0.0
        rec["est_tax_net"]   = 0.0
    else:
        gross = appr * ratio * (millage / 1000.0)
        lost  = appr * ratio * lost_rate
        net   = max(0.0, gross - lost)
        rec["est_tax_gross"] = round(gross, 2)
        rec["est_tax_net"]   = round(net,   2)
    acres = rec.get("acres_cal") or 0
    land  = rec.get("land_appr", 0) or 0
    imp   = rec.get("imp_appr",  0) or 0
    rec["value_per_acre"]    = round(appr / acres, 2) if acres > 0 else None
    rec["tax_per_acre"]      = round(rec["est_tax_net"] / acres, 2) if acres > 0 else None
    rec["land_to_imp_ratio"] = round(land / imp, 4) if imp > 0 else None


# ──────────────────────────────────────────────────────────────────────────────
# MAIN PIPELINE
# ──────────────────────────────────────────────────────────────────────────────

def run(city, state, county, millage_arg, lost_rate, output_dir, build_dashboard, skip_slim, short_name, color, description, where_filter=None):
    os.makedirs(output_dir, exist_ok=True)
    slug = short_name.lower().replace(" ", "_")

    # 1. Resolve boundary
    print(f"\n[1] Resolving boundary for {city}, {state}")
    state_fips = "45" if state.upper() == "SC" else state   # expand as needed
    city_geom, city_geoj, official_name, geoid = resolve_boundary_tiger(city, state_fips)
    polygon_acres = polygon_acres_geodetic(city_geom)
    print(f"    Polygon area: {polygon_acres:,.1f} acres")

    # Decide strategy based on polygon complexity / expected parcel count
    is_large = city_geom.geom_type == "MultiPolygon" and len(city_geom.geoms) > 5
    print(f"    Geometry: {city_geom.geom_type}, {'large (bbox strategy)' if is_large else 'simple (polygon filter)'}")

    # Save polygon
    poly_path = os.path.join(output_dir, f"{slug}_polygon.geojson")
    poly_feature = {
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "properties": {
                "name": official_name, "short": short_name, "color": color,
                "description": description, "geoid": geoid,
                "polygon_acres": round(polygon_acres, 2),
            },
            "geometry": city_geoj,
        }],
    }
    with open(poly_path, "w") as fh:
        json.dump(poly_feature, fh, separators=(",", ":"))
    print(f"    Saved: {poly_path}")

    # 2. Resolve endpoint
    print(f"\n[2] Resolving GIS endpoint for {county} County, {state}")
    rest_url, adapter_name, millage_default, default_lost = resolve_endpoint(state, county)
    if lost_rate is None:
        lost_rate = default_lost
    if millage_arg is None:
        if millage_default is None:
            print(f"    ⚠  No millage default for {county} County via SCDOT statewide data.")
            print(f"    ⚠  Millage must be provided with --millage.")
            print(f"    ⚠  Check: https://www.richlandcountysc.gov/auditor (or your county auditor).")
            sys.exit(1)
        millage = millage_default
    else:
        millage = millage_arg
    print(f"    Endpoint: {rest_url}")
    print(f"    Adapter:  {adapter_name}")
    print(f"    Millage:  {millage} mills  (LOST rate: {lost_rate})")
    if adapter_name == "scdot" and millage_arg is None:
        print(f"    ⚠  Using SCDOT default millage. Verify against your county auditor's millage card.")

    # 3. Query parcels
    print(f"\n[3] Querying parcels...")
    bbox = city_geom.bounds
    if where_filter:
        print(f"    Using WHERE filter: {where_filter}")
        raw_feats = query_parcels_where(rest_url, where_filter)
    elif is_large:
        raw_feats = query_parcels_bbox(rest_url, bbox)
    else:
        # For simple polygons, try polygon filter first
        # If polygon has too many vertices (MultiPolygon), fall back to bbox
        geom_type = city_geom.geom_type
        if geom_type == "Polygon":
            coords = list(city_geom.exterior.coords)
            if len(coords) <= 200:
                raw_feats = query_parcels_polygon(rest_url, [[list(c) for c in coords]])
            else:
                raw_feats = query_parcels_bbox(rest_url, bbox)
        else:
            raw_feats = query_parcels_bbox(rest_url, bbox)
    print(f"    Raw fetch: {len(raw_feats)} features")

    # Save raw
    raw_path = os.path.join(output_dir, f"{slug}_raw.geojson")
    with open(raw_path, "w") as fh:
        json.dump({
            "type": "FeatureCollection",
            "features": raw_feats,
        }, fh, separators=(",", ":"))
    print(f"    Saved raw: {raw_path}")

    # 4. Centroid-in-polygon filter
    print(f"\n[4] Filtering by centroid-in-polygon...")
    prep_geom = prep(city_geom)
    adapt_fn  = ADAPTERS[adapter_name]

    inside = []
    skipped_no_geom = 0
    skipped_outside = 0

    for feat in raw_feats:
        geom_raw = feat.get("geometry")
        if not geom_raw:
            skipped_no_geom += 1
            continue
        try:
            parcel_geom = shape(geom_raw)
            if parcel_geom.is_empty:
                skipped_no_geom += 1
                continue
            centroid = parcel_geom.centroid
            if not prep_geom.contains(centroid):
                skipped_outside += 1
                continue
            rec = adapt_fn(feat.get("properties", {}))
            rec["centroid_lon"] = round(centroid.x, 6)
            rec["centroid_lat"] = round(centroid.y, 6)
            rec["_geometry"]    = geom_raw    # kept for output
            inside.append(rec)
        except Exception as e:
            skipped_no_geom += 1
    print(f"    Inside polygon: {len(inside)}")
    print(f"    Skipped (outside): {skipped_outside} | (no geom): {skipped_no_geom}")

    if not inside:
        print("ERROR: No parcels inside polygon. Check endpoint and geometry.")
        sys.exit(1)

    # 5. Classify + compute tax
    print(f"\n[5] Classifying and computing tax...")
    for rec in inside:
        # Use-group
        if adapter_name == "charleston":
            rec["use_group"] = use_group_charleston(rec.get("class_code"))
            rec["is_civic_exempt"] = is_civic_exempt_charleston(rec.get("class_code"), rec.get("appraisal", 0))
        elif adapter_name == "lexington":
            rec["use_group"] = use_group_lexington(rec.get("class_code"))
            rec["is_civic_exempt"] = is_civic_exempt_lexington(rec.get("class_code"), rec.get("appraisal", 0))
        else:  # scdot
            rec["is_civic_exempt"] = is_civic_exempt_scdot(rec)
            rec["use_group"] = use_group_scdot(rec)
        # Millage by district (Charleston / Lexington)
        td = rec.get("tax_district", "")
        if adapter_name == "charleston":
            m = CHARLESTON_MILLAGE.get(td, millage)
        elif adapter_name == "lexington":
            m = LEXINGTON_MILLAGE.get(td, millage)
        else:
            m = millage
        rec["area_short"] = short_name
        compute_tax(rec, m, lost_rate)

    # 6. Land breakdown (union)
    # For large cities skip the union — use polygon area as denominator
    skip_union = len(inside) > 15_000 or is_large
    parcel_land_acres = taxable_land_acres = civic_land_acres = row_acres = None

    if not skip_union:
        print(f"\n[6] Computing land breakdown (union of {len(inside)} parcel geometries)...")
        all_shps   = []
        civic_shps = []
        for rec in inside:
            try:
                g = shape(rec["_geometry"])
                if not g.is_valid: g = make_valid(g)
                g = g.intersection(city_geom)
                all_shps.append(g)
                if rec.get("is_civic_exempt"):
                    civic_shps.append(g)
            except Exception:
                pass
        union_all   = safe_union(all_shps)
        union_civic = safe_union(civic_shps)
        if union_all:
            parcel_land_acres  = polygon_acres_geodetic(union_all)
            civic_land_acres   = polygon_acres_geodetic(union_civic) if union_civic else 0.0
            taxable_land_acres = parcel_land_acres - civic_land_acres
            row_acres          = max(0, polygon_acres - parcel_land_acres)
            print(f"    Parcel land: {parcel_land_acres:,.2f} ac | Civic: {civic_land_acres:,.2f} ac | ROW: {row_acres:,.2f} ac")
        else:
            skip_union = True
    else:
        print(f"\n[6] Large geography — skipping parcel union, using polygon area as denominator.")

    # 7. Aggregate summary
    print(f"\n[7] Aggregating summary...")
    n = len(inside)
    n_oo    = sum(1 for r in inside if r.get("legal_residence"))
    n_civic = sum(1 for r in inside if r.get("is_civic_exempt"))
    appr_total = sum(r.get("appraisal", 0) or 0 for r in inside)
    land_total = sum(r.get("land_appr",  0) or 0 for r in inside)
    imp_total  = sum(r.get("imp_appr",   0) or 0 for r in inside)
    tax_total  = sum(r.get("est_tax_net", 0) or 0 for r in inside)

    taxable_recs = [r for r in inside if not r.get("is_civic_exempt")]
    taxable_appr = sum(r.get("appraisal", 0) or 0 for r in taxable_recs)
    taxable_tax  = sum(r.get("est_tax_net", 0) or 0 for r in taxable_recs)

    denom_acres = parcel_land_acres if parcel_land_acres else polygon_acres
    taxable_denom = taxable_land_acres if taxable_land_acres else denom_acres

    summary = {
        "areas": {
            short_name: {
                "name": official_name, "short": short_name,
                "color": color, "description": description,
                "n": n, "n_oo": n_oo, "n_civic": n_civic,
                "polygon_acres": round(polygon_acres, 4),
                "parcel_land_acres": round(parcel_land_acres, 4) if parcel_land_acres else None,
                "civic_land_acres":  round(civic_land_acres, 4)  if civic_land_acres  else None,
                "taxable_land_acres": round(taxable_land_acres, 4) if taxable_land_acres else None,
                "row_acres": round(row_acres, 4) if row_acres is not None else None,
                "row_pct":   round(row_acres / polygon_acres * 100, 2) if row_acres else None,
                "appr": appr_total, "land": land_total, "imp": imp_total,
                "tax": round(tax_total, 2),
                "taxable_appr": taxable_appr, "taxable_tax": round(taxable_tax, 2),
                "vpa": round(appr_total / polygon_acres, 0)  if polygon_acres else None,
                "tpa": round(tax_total  / polygon_acres, 0)  if polygon_acres else None,
                "vpa_taxable": round(taxable_appr / taxable_denom, 0) if taxable_denom else None,
                "tpa_taxable": round(taxable_tax  / taxable_denom, 0) if taxable_denom else None,
                "land_pct": round(land_total / appr_total * 100, 2) if appr_total else 0,
                "methodology_note": (
                    "Parcel land breakdown skipped (large geography; polygon area used as denominator)."
                    if skip_union else "Full parcel union computed."
                ),
            }
        },
        "millage": millage,
        "ratio_oo": 0.04, "ratio_other": 0.06,
        "lost_rate": lost_rate,
        "source_endpoint": rest_url,
        "run_date": datetime.utcnow().strftime("%Y-%m-%d"),
    }

    summ_path = os.path.join(output_dir, f"{slug}_summary.json")
    with open(summ_path, "w") as fh:
        json.dump(summary, fh, indent=2)
    print(f"    Saved: {summ_path}")

    # 8. Print headline
    area_s = summary["areas"][short_name]
    print(f"\n{'─'*60}")
    print(f"  {official_name}")
    print(f"  Parcels:         {n:,}")
    print(f"  Total appraised: ${appr_total:,.0f}")
    print(f"  Annual tax est:  ${tax_total:,.0f}")
    print(f"  Tax/polygon ac:  ${area_s['tpa']:,.0f}" if area_s['tpa'] else "  Tax/polygon ac: N/A")
    print(f"  Tax/taxable ac:  ${area_s['tpa_taxable']:,.0f}" if area_s['tpa_taxable'] else "  Tax/taxable ac: N/A")
    print(f"  Owner-occupied:  {n_oo:,} ({100*n_oo/n:.1f}%)")
    print(f"  Civic exempt:    {n_civic:,} ({100*n_civic/n:.1f}%)")
    print(f"  Land share:      {area_s['land_pct']:.1f}%")
    print(f"{'─'*60}")

    # 9. Save data GeoJSON
    print(f"\n[9] Saving enriched GeoJSON...")
    CANONICAL_PROPS = [
        "area_short", "pid", "address", "owner1", "tax_district",
        "class_code", "use_group", "legal_residence", "is_civic_exempt",
        "acres_cal", "land_appr", "imp_appr", "appraisal",
        "value_per_acre", "tax_per_acre", "est_tax_gross", "est_tax_net",
        "assessment_ratio", "land_to_imp_ratio", "sale_price", "doc_date",
        "centroid_lon", "centroid_lat",
    ]
    features_out = []
    for rec in inside:
        props = {k: rec.get(k) for k in CANONICAL_PROPS}
        features_out.append({
            "type": "Feature",
            "geometry": rec.get("_geometry"),
            "properties": props,
        })

    data_gj = {"type": "FeatureCollection", "features": features_out}
    data_path = os.path.join(output_dir, f"{slug}_data.geojson")
    with open(data_path, "w") as fh:
        json.dump(data_gj, fh, separators=(",", ":"))
    data_size_mb = os.path.getsize(data_path) / 1_048_576
    print(f"    Saved: {data_path}  ({data_size_mb:.1f} MB)")

    # Slim variant if > 20 MB
    slim_path = None
    if data_size_mb > 20 and not skip_slim:
        print(f"    Data file {data_size_mb:.1f} MB > 20 MB — generating slim variant...")
        slim_feats = []
        for rec in inside:
            try:
                g = shape(rec["_geometry"]).simplify(0.00008, preserve_topology=True)
            except Exception:
                g = shape(rec["_geometry"])
            props = {k: rec.get(k) for k in CANONICAL_PROPS
                     if k not in ("sale_price", "doc_date")}
            # Round floats
            for k in ("acres_cal", "value_per_acre", "tax_per_acre",
                      "est_tax_gross", "est_tax_net", "land_to_imp_ratio"):
                if isinstance(props.get(k), float):
                    props[k] = round(props[k], 3)
            slim_feats.append({"type": "Feature", "geometry": mapping(g), "properties": props})
        slim_gj = {"type": "FeatureCollection", "features": slim_feats}
        slim_path = os.path.join(output_dir, f"{slug}_slim.geojson")
        with open(slim_path, "w") as fh:
            json.dump(slim_gj, fh, separators=(",", ":"))
        slim_size = os.path.getsize(slim_path) / 1_048_576
        print(f"    Saved slim: {slim_path}  ({slim_size:.1f} MB)")

    # 10. CSV
    print(f"\n[10] Saving CSV...")
    csv_path = os.path.join(output_dir, f"{slug}_parcels.csv")
    with open(csv_path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=CANONICAL_PROPS)
        writer.writeheader()
        for rec in inside:
            writer.writerow({k: rec.get(k, "") for k in CANONICAL_PROPS})
    print(f"    Saved: {csv_path}")

    # 11. Dashboard
    if build_dashboard:
        print(f"\n[11] Building dashboard...")
        dash_data_path = slim_path if slim_path else data_path
        dash_path = os.path.join(output_dir, f"{slug}_dashboard.html")
        _build_dashboard(inside, summary, city_geom, official_name, short_name,
                         color, millage, lost_rate, dash_path, dash_data_path, slug)
        print(f"    Saved: {dash_path}")

    print(f"\n✓ Pipeline complete. Outputs in: {output_dir}")
    return summary


# ──────────────────────────────────────────────────────────────────────────────
# DASHBOARD
# ──────────────────────────────────────────────────────────────────────────────

def _fmt_m(v):
    """Format as $X.XM or $XXK."""
    if v is None: return "—"
    if abs(v) >= 1_000_000: return f"${v/1_000_000:.1f}M"
    if abs(v) >= 1_000:     return f"${v/1_000:.0f}K"
    return f"${v:,.0f}"

def _fmt_c(v):
    if v is None: return "—"
    return f"${v:,.0f}"


def _build_dashboard(records, summary, city_geom, official_name, short_name,
                     color, millage, lost_rate, dash_path, data_path, slug):
    area = summary["areas"][short_name]
    n         = area["n"]
    appr      = area["appr"]
    tax       = area["tax"]
    tpa       = area.get("tpa")
    tpa_tax   = area.get("tpa_taxable")
    poly_ac   = area["polygon_acres"]
    n_civic   = area["n_civic"]
    n_oo      = area["n_oo"]
    land_pct  = area["land_pct"]

    # Use-group summary
    from collections import Counter
    use_counts = Counter(r.get("use_group","Other") for r in records)
    total_acres_by_group = {}
    for r in records:
        ug = r.get("use_group","Other")
        total_acres_by_group[ug] = total_acres_by_group.get(ug, 0) + (r.get("acres_cal") or 0)
    total_parcel_acres = sum(total_acres_by_group.values()) or 1

    use_bars_js = json.dumps([
        {"group": ug, "pct": round(ac / total_parcel_acres * 100, 1), "count": use_counts.get(ug, 0)}
        for ug, ac in sorted(total_acres_by_group.items(), key=lambda x: -x[1])
    ])

    # Top 20 by tax/acre
    top20 = sorted(
        [r for r in records if r.get("tax_per_acre") and r.get("acres_cal", 0) > 0.001],
        key=lambda x: x.get("tax_per_acre", 0), reverse=True
    )[:20]
    top20_rows = "\n".join(
        f"<tr><td>{r.get('address','')}</td>"
        f"<td>${(r.get('tax_per_acre') or 0):,.0f}</td>"
        f"<td>${(r.get('appraisal') or 0):,}</td>"
        f"<td>{r.get('use_group','')}</td></tr>"
        for r in top20
    )

    # Top civic landholders
    civic_recs = sorted(
        [r for r in records if r.get("is_civic_exempt") and (r.get("acres_cal") or 0) > 0],
        key=lambda x: x.get("acres_cal", 0), reverse=True
    )[:15]
    civic_rows = "\n".join(
        f"<tr><td>{r.get('owner1','')}</td>"
        f"<td>{(r.get('acres_cal') or 0):.2f}</td>"
        f"<td>${(r.get('appraisal') or 0):,}</td>"
        f"<td>{r.get('address','')}</td></tr>"
        for r in civic_recs
    )

    # Centroid for map
    c = city_geom.centroid
    cx, cy = round(c.x, 4), round(c.y, 4)
    bounds = city_geom.bounds
    # Rough zoom
    span = max(bounds[2]-bounds[0], bounds[3]-bounds[1])
    zoom = max(10, min(17, round(math.log2(360 / span) - 1)))

    # Inline data (limit to 5000 parcels for the dashboard to stay fast)
    dash_records = sorted(records, key=lambda x: -(x.get("tax_per_acre") or 0))
    if len(dash_records) > 5000:
        print(f"    Dashboard: sampling top 5,000 of {len(records):,} parcels by tax/acre")
        dash_records = dash_records[:5000]
    dash_feats = [
        {
            "type": "Feature",
            "geometry": r["_geometry"],
            "properties": {
                k: r.get(k) for k in [
                    "address","owner1","use_group","acres_cal","appraisal",
                    "tax_per_acre","est_tax_net","is_civic_exempt","legal_residence",
                ]
            },
        }
        for r in dash_records if r.get("_geometry")
    ]
    dash_data_inline = json.dumps({
        "type": "FeatureCollection",
        "features": dash_feats,
    }, separators=(",", ":"))

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{official_name} — Urban Productivity Dashboard</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700;900&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>
<style>
:root {{
  --bg:#FAF7F2;--bg-card:#FFFFFF;--ink:#1A1A1A;--ink-soft:#404040;--ink-mute:#7A7A7A;
  --line:#E5DFD3;--line-strong:#C9C0AC;--accent:{color};--accent-soft:#B8694D;
  --hot-1:#FFF5E1;--hot-2:#FFD78A;--hot-3:#F59E45;--hot-4:#D4501F;--hot-5:#6B1F00;
}}
*{{box-sizing:border-box;margin:0;padding:0}}
body{{background:var(--bg);color:var(--ink);font-family:Inter,sans-serif;font-size:14px}}
.header{{background:var(--ink);color:#fff;padding:32px 40px}}
.kicker{{font-size:11px;letter-spacing:.12em;text-transform:uppercase;opacity:.6;margin-bottom:8px}}
.headline{{font-family:'Playfair Display',serif;font-size:36px;font-weight:900;line-height:1.15;margin-bottom:8px}}
.subtitle{{font-size:15px;opacity:.75;margin-bottom:4px}}
.byline{{font-size:12px;opacity:.45}}
.ribbon{{display:flex;gap:1px;background:var(--line);border-bottom:1px solid var(--line)}}
.stat{{flex:1;background:var(--bg-card);padding:20px 24px;text-align:center}}
.stat-val{{font-family:'Playfair Display',serif;font-size:26px;font-weight:700;color:var(--accent)}}
.stat-lbl{{font-size:11px;color:var(--ink-mute);margin-top:4px;letter-spacing:.04em}}
.body{{display:flex;height:600px}}
#map{{flex:3;position:relative}}
.panel{{flex:2;overflow-y:auto;background:var(--bg-card);border-left:1px solid var(--line);padding:20px}}
.panel h3{{font-family:'Playfair Display',serif;font-size:16px;margin-bottom:12px;color:var(--accent)}}
.legend{{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px}}
.leg-item{{display:flex;align-items:center;gap:4px;font-size:11px;color:var(--ink-mute)}}
.leg-swatch{{width:14px;height:14px;border-radius:2px}}
table{{width:100%;border-collapse:collapse;font-size:12px}}
th{{text-align:left;padding:4px 6px;font-size:11px;color:var(--ink-mute);border-bottom:1px solid var(--line);font-weight:500}}
td{{padding:4px 6px;border-bottom:1px solid var(--line)}}
tr:hover td{{background:#f5f0ea}}
.charts{{display:flex;gap:24px;padding:24px 32px;background:var(--bg-card);border-top:1px solid var(--line)}}
.chart-wrap{{flex:1}}
.chart-wrap h4{{font-family:'Playfair Display',serif;font-size:14px;margin-bottom:8px}}
.ctx{{padding:24px 32px;font-size:13px;line-height:1.65;color:var(--ink-soft);border-top:1px solid var(--line)}}
.ctx p{{margin-bottom:10px}}
footer{{padding:16px 32px;font-size:11px;color:var(--ink-mute);border-top:1px solid var(--line)}}
.pill{{display:inline-block;background:var(--accent);color:#fff;font-size:10px;padding:2px 6px;border-radius:10px;margin-left:4px}}
.ctrl-bar{{position:absolute;top:8px;right:8px;z-index:1000;background:rgba(255,255,255,.95);border:1px solid var(--line);border-radius:6px;padding:6px 10px;display:flex;gap:8px;box-shadow:0 2px 8px rgba(0,0,0,.12)}}
.ctrl-btn{{font-size:11px;font-family:Inter,sans-serif;background:none;border:1px solid var(--line);border-radius:4px;padding:3px 8px;cursor:pointer;transition:all .15s}}
.ctrl-btn.active{{background:var(--accent);color:#fff;border-color:var(--accent)}}
</style>
</head>
<body>

<div class="header">
  <div class="kicker">Urban Productivity Analysis · {datetime.utcnow().strftime('%B %Y')}</div>
  <div class="headline">{official_name}</div>
  <div class="subtitle">Per-acre property-tax productivity — Strong Towns / Urban3 framework</div>
  <div class="byline">Jimmy Ardis · Carolina Redesign · Millage {millage} mills · SC 4%/6% assessment ratios</div>
</div>

<div class="ribbon">
  <div class="stat"><div class="stat-val">{n:,}</div><div class="stat-lbl">Parcels</div></div>
  <div class="stat"><div class="stat-val">{poly_ac:,.0f}</div><div class="stat-lbl">Polygon acres</div></div>
  <div class="stat"><div class="stat-val">{_fmt_m(appr)}</div><div class="stat-lbl">Total appraised</div></div>
  <div class="stat"><div class="stat-val">{_fmt_m(tax)}</div><div class="stat-lbl">Est. annual tax</div></div>
  <div class="stat"><div class="stat-val">{_fmt_c(tpa)}</div><div class="stat-lbl">Tax / polygon acre</div></div>
  <div class="stat"><div class="stat-val">{_fmt_c(tpa_tax)}</div><div class="stat-lbl">Tax / taxable acre</div></div>
</div>

<div class="body">
  <div id="map">
    <div class="ctrl-bar">
      <button class="ctrl-btn active" id="btn-tpa" onclick="setMetric('tax_per_acre')">Tax/acre</button>
      <button class="ctrl-btn" id="btn-val" onclick="setMetric('appraisal')">Value</button>
      <button class="ctrl-btn" id="btn-use" onclick="setMetric('use_group')">Use</button>
    </div>
  </div>
  <div class="panel">
    <h3>Top Performers — Tax per Acre</h3>
    <table>
      <thead><tr><th>Address</th><th>$/ac</th><th>Appraised</th><th>Use</th></tr></thead>
      <tbody>{top20_rows}</tbody>
    </table>
    <br>
    <h3>Civic / Exempt Landholders</h3>
    <table>
      <thead><tr><th>Owner</th><th>Acres</th><th>Appraised</th><th>Address</th></tr></thead>
      <tbody>{civic_rows}</tbody>
    </table>
  </div>
</div>

<div class="charts">
  <div class="chart-wrap">
    <h4>Land use by acreage</h4>
    <div id="chartUse" style="height:220px"></div>
  </div>
  <div class="chart-wrap">
    <h4>Tax per acre distribution</h4>
    <div id="chartHist" style="height:220px"></div>
  </div>
</div>

<div class="ctx">
  <p><strong>Methodology:</strong> Parcel data from SCDOT statewide GIS service (Richland County layer).
  Tax estimated using SC statutory formula: appraised value × assessment ratio (4% owner-occupied, 6% other) × {millage} combined mills / 1,000
  {'minus LOST credit' if lost_rate > 0 else '(no LOST credit applied)'}.
  Civic/exempt parcels ($0 tax) identified by Exemption codes.
  <strong>Millage note:</strong> Verify {millage} mills against the Richland County Auditor's current millage card at
  <a href="https://auditor.richlandcountysc.gov" target="_blank">auditor.richlandcountysc.gov</a>.</p>
  <p><strong>Land share:</strong> {land_pct:.1f}% of total appraised value is in land (vs. improvements).
  A high land share relative to improvements suggests under-building — the land earns more per dollar than what sits on it.</p>
  <p><strong>Context:</strong> For comparison, the Charleston Walled City (73 ac, 831 parcels) generates ~$334K per polygon acre.
  A typical suburban SC strip corridor generates $15–25K per polygon acre.</p>
  <p><strong>Known limitations:</strong> Parcel acreage = 0 for many condo units in SCDOT data (full building footprint not split per unit).
  Millage varies by tax district; a single rate is applied here.
  Historic, disabled-veteran, and other SC exemptions beyond the 4% ratio are not modeled.</p>
</div>

<footer>
  Jimmy Ardis · Carolina Redesign · Analysis date: {datetime.utcnow().strftime('%Y-%m-%d')} ·
  Source: SCDOT Statewide Parcels + Census TIGER + SC Auditor millage
</footer>

<script>
const PARCELS = {dash_data_inline};
const useBars = {use_bars_js};
const hotPalette = ['#FFF5E1','#FFD78A','#F59E45','#D4501F','#6B1F00'];
const useColors = {{'Residential':'#4A7A5C','Commercial':'#8B1A1A','Institutional / Civic':'#5A6B7A','Parking / ROW':'#9A9A7A','Office / Specialty':'#4A5A8B','Vacant / Other':'#C9C0AC','Specialty / condo':'#7A5A8B','Other':'#DCDCDC'}};

let currentMetric = 'tax_per_acre';
let parcelLayer = null;

const map = L.map('map', {{zoomControl:true,preferCanvas:true,scrollWheelZoom:true,attributionControl:false}})
  .setView([{cy},{cx}], {zoom});
L.tileLayer('https://{{s}}.basemaps.cartocdn.com/light_nolabels/{{z}}/{{x}}/{{y}}{{r}}.png',{{maxZoom:19,subdomains:'abcd'}}).addTo(map);
L.tileLayer('https://{{s}}.basemaps.cartocdn.com/light_only_labels/{{z}}/{{x}}/{{y}}{{r}}.png',{{maxZoom:19,subdomains:'abcd',pane:'shadowPane'}}).addTo(map);

const sortedTpa = PARCELS.features.map(f=>f.properties.tax_per_acre).filter(v=>v!=null&&!isNaN(v)).sort((a,b)=>a-b);
const sortedVal = PARCELS.features.map(f=>f.properties.appraisal).filter(v=>v!=null&&!isNaN(v)).sort((a,b)=>a-b);

function quantileColor(value, sorted) {{
  if(value==null||isNaN(value))return'#DCDCDC';
  let lo=0,hi=sorted.length;
  while(lo<hi){{const mid=(lo+hi)>>1;if(sorted[mid]<value)lo=mid+1;else hi=mid;}}
  return hotPalette[Math.min(4,Math.floor(lo/sorted.length*5))];
}}

function parcelStyle(f) {{
  const p=f.properties;
  let fc;
  if(currentMetric==='tax_per_acre') fc=quantileColor(p.tax_per_acre,sortedTpa);
  else if(currentMetric==='appraisal') fc=quantileColor(p.appraisal,sortedVal);
  else fc=useColors[p.use_group]||'#DCDCDC';
  return {{color:'#2A2A2A',weight:0.3,fillColor:fc,fillOpacity:p.is_civic_exempt?0.4:0.78}};
}}

function popup(p) {{
  return `<div style="font-family:Inter,sans-serif;font-size:12px;min-width:200px">
    <strong>${{p.address||'(no address)'}}</strong><br>
    <span style="color:#7A7A7A">${{p.owner1||''}}</span><hr style="margin:6px 0;border-color:#E5DFD3">
    <b>Use:</b> ${{p.use_group}}<br>
    <b>Appraised:</b> $$${{(p.appraisal||0).toLocaleString()}}<br>
    <b>Est. tax:</b> $$${{(p.est_tax_net||0).toLocaleString()}}<br>
    <b>Tax/acre:</b> $$${{(p.tax_per_acre||0).toLocaleString()}}<br>
    <b>Acres:</b> ${{(p.acres_cal||0).toFixed(3)}}<br>
    ${{p.is_civic_exempt?'<span style="color:#5A6B7A"><b>CIVIC / EXEMPT</b></span>':''}}
    ${{p.legal_residence?'<span style="color:#4A7A5C"><b>Owner-occupied (4%)</b></span>':''}}
  </div>`;
}}

function drawLayer() {{
  if(parcelLayer) map.removeLayer(parcelLayer);
  parcelLayer = L.geoJSON(PARCELS, {{
    style: parcelStyle,
    onEachFeature: (f,layer) => layer.bindPopup(popup(f.properties))
  }}).addTo(map);
}}

window.setMetric = function(m) {{
  currentMetric = m;
  ['btn-tpa','btn-val','btn-use'].forEach(id=>document.getElementById(id).classList.remove('active'));
  document.getElementById(m==='tax_per_acre'?'btn-tpa':m==='appraisal'?'btn-val':'btn-use').classList.add('active');
  drawLayer();
}};
drawLayer();

// Use-mix chart
echarts.init(document.getElementById('chartUse')).setOption({{
  grid:{{left:160,right:60,top:8,bottom:20}},
  xAxis:{{type:'value',axisLabel:{{formatter:v=>v+'%'}},max:100}},
  yAxis:{{type:'category',data:useBars.map(b=>b.group),axisTick:{{show:false}}}},
  series:[{{type:'bar',data:useBars.map(b=>b.pct),itemStyle:{{color:'{color}'}},
    label:{{show:true,position:'right',color:'{color}',formatter:p=>p.data+'%'}}}}]
}});

// Tax/acre histogram
const tpaVals = PARCELS.features.map(f=>f.properties.tax_per_acre).filter(v=>v!=null&&v>0);
const maxTpa = Math.max(...tpaVals);
const buckets = 15;
const step = maxTpa/buckets;
const hist = Array(buckets).fill(0);
tpaVals.forEach(v=>{{const b=Math.min(buckets-1,Math.floor(v/step));hist[b]++;}});
echarts.init(document.getElementById('chartHist')).setOption({{
  grid:{{left:60,right:20,top:8,bottom:30}},
  xAxis:{{type:'category',data:Array.from({{length:buckets}},(_,i)=>'$'+(i*step/1000).toFixed(0)+'K'),
    axisLabel:{{rotate:30,fontSize:9}}}},
  yAxis:{{type:'value',name:'parcels',nameTextStyle:{{fontSize:10}}}},
  series:[{{type:'bar',data:hist,itemStyle:{{color:'{color}',opacity:0.8}}}}]
}});
</script>
</body>
</html>"""

    with open(dash_path, "w", encoding="utf-8") as fh:
        fh.write(html)


# ──────────────────────────────────────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────────────────────────────────────

def main():
    p = argparse.ArgumentParser(description="Urban Productivity Pipeline")
    p.add_argument("--city",     required=True,  help="City name (as in Census TIGER, e.g. 'Columbia')")
    p.add_argument("--state",    required=True,  help="Two-letter state abbreviation, e.g. 'SC'")
    p.add_argument("--county",   required=True,  help="County name, e.g. 'Richland'")
    p.add_argument("--millage",  type=float,     help="Combined millage rate (mills). Required for SCDOT counties.")
    p.add_argument("--lost-rate",type=float, default=None, dest="lost_rate",
                   help="LOST credit rate (default: 0.0009 for Charleston, 0 otherwise)")
    p.add_argument("--output-dir",               help="Output directory (default: outputs/{city_slug})")
    p.add_argument("--short-name",               help="Short name for geography (default: city name)")
    p.add_argument("--color",    default="#6B1F00", help="Accent color for dashboard (default: terra cotta)")
    p.add_argument("--description", default="",  help="Description for polygon metadata")
    p.add_argument("--where",    default=None,
                   help="ArcGIS WHERE clause to pre-filter parcels (e.g. \"TAXAREA='75'\"). "
                        "Overrides geometry query; centroid-in-polygon filter still applied.")
    p.add_argument("--no-dashboard", action="store_true", help="Skip dashboard build")
    p.add_argument("--skip-slim",    action="store_true", help="Skip slim GeoJSON variant")
    args = p.parse_args()

    short_name = args.short_name or args.city
    output_dir = args.output_dir or os.path.join(
        "outputs", f"{args.city.lower().replace(' ','_')}_{args.state.lower()}"
    )

    run(
        city          = args.city,
        state         = args.state,
        county        = args.county,
        millage_arg   = args.millage,
        lost_rate     = args.lost_rate,
        output_dir    = output_dir,
        build_dashboard = not args.no_dashboard,
        skip_slim     = args.skip_slim,
        short_name    = short_name,
        color         = args.color,
        description   = args.description,
        where_filter  = args.where,
    )


if __name__ == "__main__":
    main()
