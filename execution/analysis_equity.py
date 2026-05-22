#!/usr/bin/env python3
"""
Assessment Equity Analysis — Effective Assessment Ratio by Census Tract
Answers: Are lower-value / lower-income neighborhoods assessed at higher
effective rates than wealthier ones? (Regressivity analysis)

Methodology:
  effective_ratio = county assessed market value / actual sale price
  A fair system: ratio ~1.0 across all price bands and neighborhoods.
  Regressivity: ratio is higher for lower-priced homes than higher-priced.

Usage:
  python analysis_equity.py \
    --raw outputs/columbia_sc/columbia_raw.geojson \
    --polygon outputs/columbia_sc/columbia_polygon.geojson \
    --output-dir outputs/columbia_sc \
    [--census-key YOUR_KEY]

Outputs:
  equity_sales.csv         — parcel-level sale records with computed ratios
  equity_by_tract.csv      — tract-level aggregated ratios
  equity_dashboard.html    — interactive dashboard (map + charts)
"""

import argparse
import csv
import json
import math
import os
from collections import defaultdict
from datetime import datetime

import requests
from shapely.geometry import shape
from shapely.prepared import prep
from shapely.validation import make_valid

HEADERS = {"User-Agent": "CarolinaRedesign/2.0 (assessmentequity)"}

# Qual_Code values that indicate arm's-length, market-rate sales
ARM_LENGTH_CODES = {"Q", "A"}
MIN_SALE_YEAR = 2019
MAX_SALE_YEAR = 2024
MIN_PRICE = 10_000   # exclude token / non-market transfers


# ──────────────────────────────────────────────────────────────────────────────
# DATA LOADING
# ──────────────────────────────────────────────────────────────────────────────

def load_polygon(path):
    with open(path) as f:
        gj = json.load(f)
    feat = gj["features"][0]
    geom = shape(feat["geometry"])
    if not geom.is_valid:
        geom = make_valid(geom)
    return geom


def load_and_filter_parcels(raw_path, city_geom):
    """Load raw GeoJSON, filter to city polygon, return list of dicts."""
    print("  Loading raw parcel file (this takes ~30 seconds for large files)...")
    with open(raw_path) as f:
        raw = json.load(f)

    prep_geom = prep(city_geom)
    records = []
    skipped = 0

    for feat in raw["features"]:
        geom_raw = feat.get("geometry")
        if not geom_raw:
            skipped += 1
            continue
        try:
            g = shape(geom_raw)
            if g.is_empty:
                skipped += 1
                continue
            c = g.centroid
            if not prep_geom.contains(c):
                skipped += 1
                continue
            p = feat["properties"]
            records.append({
                "tms":        str(p.get("TMS") or ""),
                "loc":        str(p.get("LOC") or "").strip(),
                "owner":      str(p.get("OwnerAll") or p.get("NAME1") or "").strip(),
                "pca":        str(p.get("PCA") or "").strip(),
                "iv":         str(p.get("I_V") or "").strip(),
                "qual_code":  str(p.get("Qual_Code") or "").strip(),
                "sale_price": _safe_int(p.get("SALEPRICE")),
                "sale_date":  str(p.get("SALEDATE") or ""),
                "assessed":   _safe_int(p.get("TotalMarket") or p.get("Total_Mkt_")),
                "land_val":   _safe_int(p.get("Market_Land") or p.get("Mkt_Val_La")),
                "acres":      _safe_float(p.get("Acres") or p.get("acreage")),
                "nbhd":       str(p.get("NBHD") or "").strip(),
                "zoningcode": str(p.get("ZONINGCODE") or "").strip(),
                "exemption1": str(p.get("Exemption1") or "").strip(),
                "taxarea":    str(p.get("TAXAREA") or "").strip(),
                "centroid_lon": round(c.x, 6),
                "centroid_lat": round(c.y, 6),
            })
        except Exception:
            skipped += 1

    print(f"  Inside polygon: {len(records):,} | Skipped: {skipped:,}")
    return records


def _safe_int(v, default=0):
    try:
        return int(float(str(v).replace(",", "").strip()))
    except (TypeError, ValueError):
        return default

def _safe_float(v, default=0.0):
    try:
        f = float(str(v).replace(",", "").strip())
        return f if math.isfinite(f) else default
    except (TypeError, ValueError):
        return default


# ──────────────────────────────────────────────────────────────────────────────
# ARM'S LENGTH FILTER + RATIO COMPUTATION
# ──────────────────────────────────────────────────────────────────────────────

def parse_sale_year(date_str):
    """Parse '3/15/2022 12:00:00 AM' → 2022, or None."""
    s = str(date_str).strip()
    if not s or s in ("None", ""):
        return None
    try:
        parts = s.split("/")
        if len(parts) >= 3:
            yr = int(parts[2].split(" ")[0])
            return yr
        return None
    except (ValueError, IndexError):
        return None


def filter_to_sales(records):
    """Return only arm's-length sales within the target year range."""
    sales = []
    for r in records:
        # Arm's-length qual code
        if r["qual_code"].upper() not in ARM_LENGTH_CODES:
            continue
        # Improved property (has a building)
        if r["iv"].upper() != "I":
            continue
        # Price above threshold
        if r["sale_price"] < MIN_PRICE:
            continue
        # Valid assessed value
        if r["assessed"] <= 0:
            continue
        # Sale year in window
        yr = parse_sale_year(r["sale_date"])
        if yr is None or not (MIN_SALE_YEAR <= yr <= MAX_SALE_YEAR):
            continue
        # Skip civic/exempt
        if r["exemption1"].startswith("EX"):
            continue
        # Compute ratio
        ratio = r["assessed"] / r["sale_price"]
        # Exclude extreme outliers (ratio < 0.1 or > 5.0)
        if not (0.1 <= ratio <= 5.0):
            continue
        r = dict(r)   # copy
        r["sale_year"] = yr
        r["eff_ratio"] = round(ratio, 4)
        r["imp_val"] = max(0, r["assessed"] - r["land_val"])
        r["land_to_imp"] = round(r["land_val"] / r["imp_val"], 3) if r["imp_val"] > 0 else None
        r["pct_land"] = round(r["land_val"] / r["assessed"] * 100, 1) if r["assessed"] > 0 else None
        sales.append(r)
    return sales


# ──────────────────────────────────────────────────────────────────────────────
# CENSUS TRACT SPATIAL JOIN
# ──────────────────────────────────────────────────────────────────────────────

def fetch_tract_boundaries(state_fips, county_fips):
    """Download census tract polygons from TIGER REST."""
    print("  Downloading census tract boundaries from TIGER...")
    url = ("https://tigerweb.geo.census.gov/arcgis/rest/services"
           "/TIGERweb/Tracts_Blocks/MapServer/0/query")
    params = {
        "where": f"STATE='{state_fips}' AND COUNTY='{county_fips}'",
        "outFields": "GEOID,NAME,TRACT",
        "returnGeometry": "true",
        "outSR": "4326",
        "f": "geojson",
    }
    r = requests.get(url, params=params, headers=HEADERS, timeout=60)
    r.raise_for_status()
    gj = r.json()
    tracts = []
    for feat in gj.get("features", []):
        try:
            g = shape(feat["geometry"])
            if not g.is_valid:
                g = make_valid(g)
            tracts.append({
                "geoid": feat["properties"]["GEOID"],
                "name":  feat["properties"]["NAME"],
                "geom":  g,
                "prep":  prep(g),
                "geojson_geom": feat["geometry"],
            })
        except Exception:
            pass
    print(f"  Loaded {len(tracts)} census tracts")
    return tracts


def assign_tracts(sales, tracts):
    """Add census tract GEOID to each sale record."""
    for rec in sales:
        pt_x, pt_y = rec["centroid_lon"], rec["centroid_lat"]
        from shapely.geometry import Point
        pt = Point(pt_x, pt_y)
        rec["tract_geoid"] = None
        rec["tract_name"] = None
        for t in tracts:
            if t["prep"].contains(pt):
                rec["tract_geoid"] = t["geoid"]
                rec["tract_name"]  = t["name"]
                break
    assigned = sum(1 for r in sales if r["tract_geoid"])
    print(f"  Tract assignment: {assigned:,}/{len(sales):,} parcels matched")
    return sales


# ──────────────────────────────────────────────────────────────────────────────
# OPTIONAL: CENSUS ACS DEMOGRAPHICS
# ──────────────────────────────────────────────────────────────────────────────

def fetch_acs_demographics(state_fips, county_fips, census_key):
    """Fetch median income + race/tenure by tract from Census ACS 5-year."""
    if not census_key:
        return {}
    print("  Fetching ACS demographics from Census API...")
    url = "https://api.census.gov/data/2022/acs/acs5"
    params = {
        "get": "NAME,B19013_001E,B03002_001E,B03002_003E,B25003_001E,B25003_002E",
        "for": "tract:*",
        "in": f"state:{state_fips} county:{county_fips}",
        "key": census_key,
    }
    r = requests.get(url, params=params, headers=HEADERS, timeout=30)
    if r.status_code != 200 or "html" in r.headers.get("Content-Type",""):
        print(f"  ⚠  ACS fetch failed ({r.status_code}). Proceeding without demographics.")
        return {}
    rows = r.json()
    header = rows[0]
    demo = {}
    for row in rows[1:]:
        d = dict(zip(header, row))
        geoid = f"{state_fips}{county_fips}{d['tract']}"
        total_pop = _safe_int(d.get("B03002_001E", 0))
        white_nh  = _safe_int(d.get("B03002_003E", 0))
        pct_nonwhite = round((1 - white_nh/total_pop)*100, 1) if total_pop > 0 else None
        total_hu = _safe_int(d.get("B25003_001E", 0))
        owner_hu = _safe_int(d.get("B25003_002E", 0))
        pct_renter = round((1 - owner_hu/total_hu)*100, 1) if total_hu > 0 else None
        demo[geoid] = {
            "med_income":   _safe_int(d.get("B19013_001E", -1)),
            "pct_nonwhite": pct_nonwhite,
            "pct_renter":   pct_renter,
        }
    print(f"  ACS data for {len(demo)} tracts")
    return demo


# ──────────────────────────────────────────────────────────────────────────────
# TRACT-LEVEL AGGREGATION
# ──────────────────────────────────────────────────────────────────────────────

def _median(vals):
    s = sorted(v for v in vals if v is not None)
    if not s: return None
    n = len(s)
    return s[n//2] if n % 2 else (s[n//2-1]+s[n//2])/2

def _mean(vals):
    s = [v for v in vals if v is not None]
    return sum(s)/len(s) if s else None


def aggregate_by_tract(sales, tracts, demo):
    """Roll up sale records to census-tract level."""
    by_tract = defaultdict(list)
    for r in sales:
        g = r.get("tract_geoid")
        if g:
            by_tract[g].append(r)

    tract_meta = {t["geoid"]: t for t in tracts}
    rows = []
    for geoid, recs in by_tract.items():
        ratios   = [r["eff_ratio"] for r in recs]
        prices   = [r["sale_price"] for r in recs]
        assessed = [r["assessed"] for r in recs]
        d = demo.get(geoid, {})
        rows.append({
            "geoid":          geoid,
            "tract_name":     tract_meta.get(geoid, {}).get("name", ""),
            "n_sales":        len(recs),
            "median_ratio":   round(_median(ratios), 4) if ratios else None,
            "mean_ratio":     round(_mean(ratios), 4)   if ratios else None,
            "median_price":   round(_median(prices), 0),
            "median_assessed":round(_median(assessed), 0),
            "med_income":     d.get("med_income"),
            "pct_nonwhite":   d.get("pct_nonwhite"),
            "pct_renter":     d.get("pct_renter"),
            "geojson_geom":   tract_meta.get(geoid, {}).get("geojson_geom"),
        })
    rows.sort(key=lambda x: -(x["median_ratio"] or 0))
    return rows


# ──────────────────────────────────────────────────────────────────────────────
# PRICE DECILE TABLE (for scatter / regressivity chart)
# ──────────────────────────────────────────────────────────────────────────────

def price_decile_summary(sales, n_buckets=10):
    """Bin sales by sale price decile, compute median ratio per bin."""
    prices = sorted(r["sale_price"] for r in sales)
    bucket_size = len(prices) // n_buckets
    results = []
    for i in range(n_buckets):
        lo = prices[i * bucket_size]
        hi = prices[min((i+1)*bucket_size - 1, len(prices)-1)]
        in_bucket = [r for r in sales if lo <= r["sale_price"] <= hi]
        ratios = [r["eff_ratio"] for r in in_bucket]
        results.append({
            "bucket": i+1,
            "price_lo": lo, "price_hi": hi,
            "n": len(in_bucket),
            "median_ratio": round(_median(ratios), 4) if ratios else None,
            "label": f"${lo//1000}K–${hi//1000}K",
        })
    return results


# ──────────────────────────────────────────────────────────────────────────────
# OUTPUT FILES
# ──────────────────────────────────────────────────────────────────────────────

SALE_FIELDS = [
    "tms","loc","owner","pca","iv","qual_code","sale_price","sale_year",
    "assessed","land_val","imp_val","acres","eff_ratio","pct_land",
    "land_to_imp","nbhd","zoningcode","tract_geoid","tract_name",
    "centroid_lon","centroid_lat",
]

def save_csvs(sales, tract_rows, output_dir, slug):
    sale_path = os.path.join(output_dir, f"{slug}_equity_sales.csv")
    with open(sale_path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=SALE_FIELDS)
        w.writeheader()
        for r in sales:
            w.writerow({k: r.get(k,"") for k in SALE_FIELDS})
    print(f"  Saved: {sale_path}")

    tract_path = os.path.join(output_dir, f"{slug}_equity_by_tract.csv")
    tract_fields = ["geoid","tract_name","n_sales","median_ratio","mean_ratio",
                    "median_price","median_assessed","med_income","pct_nonwhite","pct_renter"]
    with open(tract_path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=tract_fields)
        w.writeheader()
        for r in tract_rows:
            w.writerow({k: r.get(k,"") for k in tract_fields})
    print(f"  Saved: {tract_path}")


def _fmt_ratio(v):
    return f"{v:.2f}×" if v else "—"

def _fmt_k(v):
    if v is None: return "—"
    return f"${v/1000:.0f}K"


def build_dashboard(sales, tract_rows, decile_rows, city_name, output_dir, slug, has_demo):
    # Build tract GeoJSON for map (coloured by median_ratio)
    tract_feats = []
    for t in tract_rows:
        if not t.get("geojson_geom") or t.get("median_ratio") is None:
            continue
        props = {k: t.get(k) for k in
                 ["geoid","tract_name","n_sales","median_ratio","mean_ratio",
                  "median_price","median_assessed","med_income","pct_nonwhite","pct_renter"]}
        tract_feats.append({"type":"Feature","geometry":t["geojson_geom"],"properties":props})
    tract_gj = json.dumps({"type":"FeatureCollection","features":tract_feats},
                          separators=(",",":"))

    # Scatter sample: max 2000 points for the JS scatter
    import random
    scatter_sample = random.sample(sales, min(2000, len(sales)))
    scatter_data = json.dumps([{
        "price": r["sale_price"], "ratio": r["eff_ratio"],
        "loc": r["loc"], "yr": r["sale_year"],
    } for r in scatter_sample], separators=(",",":"))

    # Decile chart data
    decile_js = json.dumps([{
        "label": d["label"],
        "ratio": d["median_ratio"],
        "n": d["n"],
    } for d in decile_rows], separators=(",",":"))

    # Top/bottom tracts table
    top_over = [t for t in tract_rows if t.get("n_sales",0) >= 10][:10]
    top_under = sorted([t for t in tract_rows if t.get("n_sales",0) >= 10],
                       key=lambda x: x.get("median_ratio") or 9)[: 10]

    def tract_row(t):
        ratio  = _fmt_ratio(t.get("median_ratio"))
        price  = _fmt_k(t.get("median_price"))
        income = f"${t['med_income']:,}" if t.get("med_income") and t["med_income"] > 0 else "—"
        nonwhite = f"{t['pct_nonwhite']:.0f}%" if t.get("pct_nonwhite") is not None else "—"
        return (f"<tr><td>{t.get('tract_name','')}</td><td><b>{ratio}</b></td>"
                f"<td>{price}</td><td>{t.get('n_sales',0)}</td>"
                f"<td>{income}</td><td>{nonwhite}</td></tr>")

    over_rows  = "\n".join(tract_row(t) for t in top_over)
    under_rows = "\n".join(tract_row(t) for t in top_under)

    # Overall stats
    all_ratios = [r["eff_ratio"] for r in sales]
    oo_ratios  = [r["eff_ratio"] for r in sales if r["pca"] == ".04"]
    no_ratios  = [r["eff_ratio"] for r in sales if r["pca"] == ".06"]
    overall_med = _median(all_ratios)
    oo_med = _median(oo_ratios)
    no_med = _median(no_ratios)

    # Map center
    lons = [r["centroid_lon"] for r in sales]
    lats = [r["centroid_lat"] for r in sales]
    cx = sum(lons)/len(lons) if lons else -81.03
    cy = sum(lats)/len(lats) if lats else 34.00

    # Determine if over- or under-assessed for the narrative
    direction = "over" if (overall_med or 1.0) > 1.02 else "under" if (overall_med or 1.0) < 0.98 else "near-fairly"
    regressivity_note = ""
    if len(decile_rows) >= 2:
        lo_ratio = decile_rows[0].get("median_ratio") or 1.0
        hi_ratio = decile_rows[-1].get("median_ratio") or 1.0
        if lo_ratio > hi_ratio + 0.05:
            regressivity_note = (f"The cheapest homes (bottom price decile) have a median ratio of "
                                 f"<b>{lo_ratio:.2f}×</b> vs. "
                                 f"<b>{hi_ratio:.2f}×</b> for the most expensive — "
                                 f"a classic regressive pattern.")
        elif hi_ratio > lo_ratio + 0.05:
            regressivity_note = (f"Surprisingly, higher-value homes show higher effective ratios "
                                 f"({hi_ratio:.2f}× vs. {lo_ratio:.2f}×) — a progressive pattern.")
        else:
            regressivity_note = "Effective ratios are roughly consistent across price bands."

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{city_name} — Assessment Equity Analysis</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700;900&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>
<style>
:root{{--bg:#FAF7F2;--bg-card:#fff;--ink:#1A1A1A;--ink-soft:#404040;--ink-mute:#7A7A7A;
  --line:#E5DFD3;--accent:#003B5C;--accent-soft:#2E6B9A;
  --over:#8B1A1A;--fair:#4A7A5C;--under:#1C3A4A;}}
*{{box-sizing:border-box;margin:0;padding:0}}
body{{background:var(--bg);color:var(--ink);font-family:Inter,sans-serif;font-size:14px}}
.header{{background:var(--ink);color:#fff;padding:32px 40px}}
.kicker{{font-size:11px;letter-spacing:.12em;text-transform:uppercase;opacity:.6;margin-bottom:8px}}
.headline{{font-family:'Playfair Display',serif;font-size:34px;font-weight:900;margin-bottom:8px}}
.subtitle{{font-size:14px;opacity:.7;margin-bottom:4px}}
.byline{{font-size:11px;opacity:.4}}
.ribbon{{display:flex;gap:1px;background:var(--line);border-bottom:1px solid var(--line)}}
.stat{{flex:1;background:var(--bg-card);padding:18px 20px;text-align:center}}
.stat-val{{font-family:'Playfair Display',serif;font-size:28px;font-weight:700}}
.stat-val.over{{color:var(--over)}}
.stat-val.fair{{color:var(--fair)}}
.stat-lbl{{font-size:11px;color:var(--ink-mute);margin-top:4px}}
.body{{display:flex;height:560px}}
#map{{flex:3}}
.panel{{flex:2;overflow-y:auto;background:var(--bg-card);border-left:1px solid var(--line);padding:16px}}
.panel h3{{font-family:'Playfair Display',serif;font-size:15px;margin-bottom:10px;color:var(--accent)}}
.legend{{display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap}}
.leg-item{{display:flex;align-items:center;gap:4px;font-size:11px;color:var(--ink-mute)}}
.leg-sw{{width:16px;height:12px;border-radius:2px}}
table{{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:16px}}
th{{text-align:left;padding:4px 6px;font-size:11px;color:var(--ink-mute);border-bottom:1px solid var(--line)}}
td{{padding:4px 6px;border-bottom:1px solid var(--line)}}
tr:hover td{{background:#f5f0ea}}
.charts{{display:flex;gap:20px;padding:20px 28px;background:var(--bg-card);border-top:1px solid var(--line)}}
.chart-wrap{{flex:1}}
.chart-wrap h4{{font-family:'Playfair Display',serif;font-size:14px;margin-bottom:8px}}
.ctx{{padding:20px 28px;font-size:13px;line-height:1.7;color:var(--ink-soft);border-top:1px solid var(--line)}}
.ctx p{{margin-bottom:10px}}
.callout{{background:#fff8f5;border-left:4px solid var(--over);padding:12px 16px;margin-bottom:12px;border-radius:0 4px 4px 0}}
footer{{padding:14px 28px;font-size:11px;color:var(--ink-mute);border-top:1px solid var(--line)}}
.no-demo-note{{font-size:11px;color:var(--ink-mute);font-style:italic;margin-top:4px}}
</style>
</head>
<body>

<div class="header">
  <div class="kicker">Assessment Equity Analysis · {datetime.now().strftime('%B %Y')}</div>
  <div class="headline">{city_name} — Effective Assessment Ratios</div>
  <div class="subtitle">Are all properties assessed fairly relative to market value?</div>
  <div class="byline">Methodology: arm's-length sales {MIN_SALE_YEAR}–{MAX_SALE_YEAR} only ·
    Effective ratio = County assessed value ÷ Sale price ·
    Fair system = 1.00× across all price bands</div>
</div>

<div class="ribbon">
  <div class="stat">
    <div class="stat-val {'over' if (overall_med or 1.0) > 1.02 else 'fair'}">{overall_med:.2f}×</div>
    <div class="stat-lbl">Median effective ratio (all)</div>
  </div>
  <div class="stat">
    <div class="stat-val {'over' if (oo_med or 1.0) > 1.02 else 'fair'}">{oo_med:.2f}×</div>
    <div class="stat-lbl">Owner-occupied (4% ratio)</div>
  </div>
  <div class="stat">
    <div class="stat-val {'over' if (no_med or 1.0) > 1.02 else 'fair'}">{no_med:.2f}×</div>
    <div class="stat-lbl">Non-owner-occupied (6% ratio)</div>
  </div>
  <div class="stat">
    <div class="stat-val">{len(sales):,}</div>
    <div class="stat-lbl">Arm's-length sales analyzed</div>
  </div>
  <div class="stat">
    <div class="stat-val">{len(tract_rows):,}</div>
    <div class="stat-lbl">Census tracts with data</div>
  </div>
</div>

<div class="body">
  <div id="map"></div>
  <div class="panel">
    <h3>Legend</h3>
    <div class="legend">
      <div class="leg-item"><div class="leg-sw" style="background:#8B1A1A"></div>Over-assessed (&gt;1.2×)</div>
      <div class="leg-item"><div class="leg-sw" style="background:#D4501F"></div>Slightly over (1.0–1.2×)</div>
      <div class="leg-item"><div class="leg-sw" style="background:#4A7A5C"></div>Near-fair (0.9–1.0×)</div>
      <div class="leg-item"><div class="leg-sw" style="background:#1C3A4A"></div>Under-assessed (&lt;0.9×)</div>
      <div class="leg-item"><div class="leg-sw" style="background:#ccc"></div>Insufficient data</div>
    </div>
    <h3>Most Over-Assessed Tracts</h3>
    <table>
      <thead><tr><th>Tract</th><th>Ratio</th><th>Med. Price</th><th>Sales</th>
        <th>Income</th><th>Non-white</th></tr></thead>
      <tbody>{over_rows}</tbody>
    </table>
    <h3>Most Under-Assessed Tracts</h3>
    <table>
      <thead><tr><th>Tract</th><th>Ratio</th><th>Med. Price</th><th>Sales</th>
        <th>Income</th><th>Non-white</th></tr></thead>
      <tbody>{under_rows}</tbody>
    </table>
    {'<p class="no-demo-note">Income and non-white columns require --census-key. See README.</p>' if not has_demo else ''}
  </div>
</div>

<div class="charts">
  <div class="chart-wrap">
    <h4>Effective ratio by sale price decile</h4>
    <div id="chartDecile" style="height:240px"></div>
  </div>
  <div class="chart-wrap">
    <h4>Assessed value vs. sale price (sample {min(2000,len(sales)):,} sales)</h4>
    <div id="chartScatter" style="height:240px"></div>
  </div>
</div>

<div class="ctx">
  <div class="callout">{regressivity_note}</div>
  <p><strong>How to read this:</strong>
  An effective assessment ratio of <b>1.0×</b> means the county's assessed value equals what the property sold for —
  a perfectly fair assessment. A ratio above 1.0 means the property is over-assessed (owner is paying taxes on more value
  than the market says the property is worth). A ratio below 1.0 means under-assessed.</p>
  <p><strong>Why it matters:</strong>
  When lower-value homes are systematically over-assessed relative to higher-value homes, lower-income homeowners pay
  a higher effective tax rate on their wealth. This is a form of regressive taxation that compounds with income inequality.
  Cook County, Illinois is the most-studied case nationally; similar patterns have been documented in Detroit, Philadelphia,
  and across the South.</p>
  <p><strong>Data:</strong>
  {len(sales):,} arm's-length residential sales, {MIN_SALE_YEAR}–{MAX_SALE_YEAR},
  Richland County SCDOT parcel data. Excludes: non-arm's-length transfers (Qual_Code ≠ Q/A),
  vacant land, civic/exempt parcels, sales under ${MIN_PRICE:,}.</p>
  {'<p><strong>Demographic data:</strong> Not loaded. Provide --census-key for income/race overlays.</p>' if not has_demo else ''}
</div>

<footer>
  Jimmy Ardis · Carolina Redesign · Run date: {datetime.now().strftime('%Y-%m-%d')} ·
  Strong Towns / Urban3 methodology
</footer>

<script>
const TRACTS = {tract_gj};
const SCATTER = {scatter_data};
const DECILES = {decile_js};

function ratioColor(r) {{
  if(r==null) return '#cccccc';
  if(r>1.2)  return '#8B1A1A';
  if(r>1.0)  return '#D4501F';
  if(r>0.9)  return '#4A7A5C';
  return '#1C3A4A';
}}

const map = L.map('map',{{zoomControl:true,preferCanvas:true,scrollWheelZoom:true,attributionControl:false}})
  .setView([{cy:.4f},{cx:.4f}],12);
L.tileLayer('https://{{s}}.basemaps.cartocdn.com/light_nolabels/{{z}}/{{x}}/{{y}}{{r}}.png',
  {{maxZoom:19,subdomains:'abcd'}}).addTo(map);
L.tileLayer('https://{{s}}.basemaps.cartocdn.com/light_only_labels/{{z}}/{{x}}/{{y}}{{r}}.png',
  {{maxZoom:19,subdomains:'abcd',pane:'shadowPane'}}).addTo(map);

L.geoJSON(TRACTS,{{
  style:f=>{{
    const r=f.properties.median_ratio;
    return {{color:'#888',weight:1,fillColor:ratioColor(r),fillOpacity:r!=null?0.72:0.15}};
  }},
  onEachFeature:(f,layer)=>{{
    const p=f.properties;
    layer.bindPopup(`<div style="font-family:Inter,sans-serif;font-size:12px;min-width:180px">
      <b>${{p.tract_name}}</b><hr style="margin:5px 0;border-color:#E5DFD3">
      <b>Median effective ratio:</b> ${{p.median_ratio!=null?p.median_ratio.toFixed(3)+'×':'—'}}<br>
      <b>Sales analyzed:</b> ${{p.n_sales}}<br>
      <b>Median sale price:</b> $${{(p.median_price||0).toLocaleString()}}<br>
      ${{p.med_income?'<b>Median income:</b> $'+p.med_income.toLocaleString()+'<br>':''}}
      ${{p.pct_nonwhite!=null?'<b>% Non-white:</b> '+p.pct_nonwhite+'%<br>':''}}
    </div>`);
  }}
}}).addTo(map);

// Decile chart
echarts.init(document.getElementById('chartDecile')).setOption({{
  grid:{{left:60,right:20,top:16,bottom:60}},
  xAxis:{{type:'category',data:DECILES.map(d=>d.label),axisLabel:{{rotate:40,fontSize:9}}}},
  yAxis:{{type:'value',min:0.7,max:1.5,
    axisLine:{{show:true}},
    markLine:{{data:[{{yAxis:1.0,label:{{formatter:'Fair (1.0×)',position:'end'}}}}]}}
  }},
  series:[{{
    type:'bar',data:DECILES.map(d=>d.ratio),
    itemStyle:{{color:p=>p.data>1.05?'#8B1A1A':p.data<0.95?'#1C3A4A':'#4A7A5C'}},
    label:{{show:true,position:'top',formatter:p=>p.data?p.data.toFixed(2)+'×':'',fontSize:10}}
  }}],
  tooltip:{{trigger:'axis',formatter:p=>`${{p[0].name}}: ${{p[0].value?.toFixed(3)}}× median ratio<br>n=${{DECILES[p[0].dataIndex]?.n}}`}}
}});

// Scatter chart
const maxP = Math.max(...SCATTER.map(d=>d.price));
echarts.init(document.getElementById('chartScatter')).setOption({{
  grid:{{left:60,right:20,top:16,bottom:40}},
  xAxis:{{type:'value',name:'Sale Price',nameLocation:'middle',nameGap:28,
    axisLabel:{{formatter:v=>'$'+Math.round(v/1000)+'K'}},max:Math.min(maxP,800000)}},
  yAxis:{{type:'value',name:'Ratio',min:0.3,max:2.5,
    axisLine:{{show:true}},
    markLine:{{data:[{{yAxis:1.0,lineStyle:{{color:'#4A7A5C',type:'dashed'}}}}]}}}},
  series:[{{
    type:'scatter',
    data:SCATTER.map(d=>[d.price,d.ratio]),
    symbolSize:4,
    itemStyle:{{color:d=>d.data[1]>1.2?'rgba(139,26,26,0.5)':d.data[1]<0.8?'rgba(28,58,74,0.5)':'rgba(74,122,92,0.5)'}},
  }}],
  tooltip:{{trigger:'item',formatter:p=>`${{SCATTER[p.dataIndex]?.loc}}<br>Sale: $${{p.data[0].toLocaleString()}}<br>Ratio: ${{p.data[1].toFixed(3)}}×`}}
}});
</script>
</body>
</html>"""

    path = os.path.join(output_dir, f"{slug}_equity_dashboard.html")
    with open(path, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"  Saved: {path}")


# ──────────────────────────────────────────────────────────────────────────────
# MAIN
# ──────────────────────────────────────────────────────────────────────────────

def main():
    p = argparse.ArgumentParser(description="Assessment Equity Analysis")
    p.add_argument("--raw",        required=True,  help="Path to *_raw.geojson from pipeline")
    p.add_argument("--polygon",    required=True,  help="Path to *_polygon.geojson from pipeline")
    p.add_argument("--output-dir", required=True,  help="Output directory")
    p.add_argument("--slug",       default="",     help="File prefix (default: inferred from --raw)")
    p.add_argument("--state-fips", default="45",   help="State FIPS code (default: 45 for SC)")
    p.add_argument("--county-fips",default="079",  help="County FIPS code (default: 079 for Richland)")
    p.add_argument("--census-key", default=None,   help="Census API key for demographic enrichment")
    p.add_argument("--city-name",  default="City", help="Display name for dashboard title")
    args = p.parse_args()

    slug = args.slug or os.path.basename(args.raw).replace("_raw.geojson","")
    os.makedirs(args.output_dir, exist_ok=True)

    print(f"\n[1] Loading city polygon...")
    city_geom = load_polygon(args.polygon)

    print(f"\n[2] Loading and filtering parcels...")
    records = load_and_filter_parcels(args.raw, city_geom)

    print(f"\n[3] Filtering to arm's-length sales ({MIN_SALE_YEAR}–{MAX_SALE_YEAR})...")
    sales = filter_to_sales(records)
    print(f"  Arm's-length sales: {len(sales):,}")

    print(f"\n[4] Downloading census tract boundaries...")
    tracts = fetch_tract_boundaries(args.state_fips, args.county_fips)

    print(f"\n[5] Assigning parcels to census tracts...")
    sales = assign_tracts(sales, tracts)

    print(f"\n[6] Fetching ACS demographics...")
    demo = fetch_acs_demographics(args.state_fips, args.county_fips, args.census_key)
    has_demo = bool(demo)

    print(f"\n[7] Aggregating by census tract...")
    tract_rows = aggregate_by_tract(sales, tracts, demo)
    for t in tract_rows:
        if demo.get(t["geoid"]):
            t.update(demo[t["geoid"]])

    print(f"\n[8] Computing price-decile regressivity table...")
    decile_rows = price_decile_summary(sales)

    # Print summary
    all_ratios = [r["eff_ratio"] for r in sales]
    med = _median(all_ratios)
    lo  = _median([r["eff_ratio"] for r in sales if r["sale_price"] < 150_000])
    hi  = _median([r["eff_ratio"] for r in sales if r["sale_price"] > 400_000])
    print(f"\n{'─'*60}")
    print(f"  {args.city_name} — Assessment Equity Summary")
    print(f"  Arm's-length sales analyzed: {len(sales):,}")
    print(f"  Median effective ratio (all):     {med:.3f}×")
    print(f"  Median ratio — sales < $150K:     {lo:.3f}×" if lo else "  (no sales < $150K)")
    print(f"  Median ratio — sales > $400K:     {hi:.3f}×" if hi else "  (no sales > $400K)")
    if lo and hi:
        direction = "REGRESSIVE" if lo > hi + 0.03 else "PROGRESSIVE" if hi > lo + 0.03 else "NEUTRAL"
        print(f"  Pattern: {direction} (cheap/expensive spread: {lo-hi:+.3f})")
    print(f"{'─'*60}")

    print(f"\n[9] Saving outputs...")
    save_csvs(sales, tract_rows, args.output_dir, slug)

    print(f"\n[10] Building dashboard...")
    build_dashboard(sales, tract_rows, decile_rows, args.city_name,
                    args.output_dir, slug, has_demo)

    print(f"\n✓ Equity analysis complete.")


if __name__ == "__main__":
    main()
