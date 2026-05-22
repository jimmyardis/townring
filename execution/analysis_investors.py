#!/usr/bin/env python3
"""
Institutional Investor & Absentee Landlord Analysis
Maps corporate ownership, out-of-state buyers, and portfolio landlords.

Classification hierarchy (applied in order):
  1. Owner-occupied (PCA=.04 = legal residence exemption) → "Owner-Occupied"
  2. LLC / corporate keyword in owner name               → "Corporate / LLC"
  3. Mailing state != SC                                 → "Out-of-State"
  4. Mailing address != property address (in-state)      → "Local Absentee"
  5. Otherwise                                           → "Owner-Occupied (unverified)"

Portfolio detection: group by normalized mailing address → any address
appearing as the mailing address for 3+ parcels = institutional portfolio.

Usage:
  python analysis_investors.py \
    --raw outputs/columbia_sc/columbia_raw.geojson \
    --polygon outputs/columbia_sc/columbia_polygon.geojson \
    --output-dir outputs/columbia_sc

Outputs:
  investor_parcels.csv        — parcel-level classification
  investor_portfolios.csv     — top landlords ranked by parcel count
  investor_dashboard.html     — interactive map + charts
"""

import argparse
import csv
import json
import math
import os
import re
from collections import Counter, defaultdict
from datetime import datetime

import requests
from shapely.geometry import shape
from shapely.prepared import prep
from shapely.validation import make_valid

HEADERS = {"User-Agent": "CarolinaRedesign/2.0 (investoranalysis)"}

# Keywords that flag corporate / institutional ownership
CORP_KEYWORDS = [
    r"\bLLC\b", r"\bL\.L\.C\b", r"\bINC\b", r"\bINC\.\b",
    r"\bCORP\b", r"\bCORPORATION\b", r"\bLTD\b", r"\bL\.P\b", r"\bLP\b",
    r"\bPARTNERS\b", r"\bPARTNERSHIP\b", r"\bHOLDINGS\b", r"\bHOLDING\b",
    r"\bPROPERTIES\b", r"\bPROPERTY\b",
    r"\bINVESTMENTS\b", r"\bINVESTMENT\b",
    r"\bREALTY\b", r"\bREAL ESTATE\b",
    r"\bCAPITAL\b", r"\bCAPITALS\b",
    r"\bGROUP\b", r"\bGROUPS\b",
    r"\bFUND\b", r"\bFUNDS\b",
    r"\bASSOCIATES\b", r"\bASSOCIATION\b",
    r"\bMANAGEMENT\b", r"\bMANAGERS\b",
    r"\bVENTURES\b", r"\bVENTURE\b",
    r"\bDEVELOPMENT\b", r"\bDEVELOPERS\b",
    r"\bRENTALS\b", r"\bRENTAL\b",
    r"\bTRUST\b",         # includes family trusts + institutional trusts
    r"\bESTATE OF\b",
    r"\bREVOCABLE\b",
    r"\bIRREVOCABLE\b",
]

# Trusts that are typically owner-occupied (not investor)
FAMILY_TRUST_PATTERN = re.compile(
    r"\b(REVOCABLE LIVING|REVOCABLE INTER VIVOS|FAMILY TRUST|LIVING TRUST)\b",
    re.IGNORECASE
)

CORP_RE = re.compile("|".join(CORP_KEYWORDS), re.IGNORECASE)

# Fields needed from raw parcel data
NEEDED_FIELDS = [
    "TMS", "LOC", "NAME1", "NAME2", "OwnerAll",
    "ADDRESS1", "ADDRESS2", "CITY", "STATE", "ZIPCODE",
    "PCA", "I_V", "TAXAREA", "Exemption1",
    "TotalMarket", "Market_Land", "Acres",
    "SALEPRICE", "SALEDATE",
]


# ──────────────────────────────────────────────────────────────────────────────
# DATA LOADING
# ──────────────────────────────────────────────────────────────────────────────

def _safe_int(v, default=0):
    try:
        return int(float(str(v).replace(",","").strip()))
    except (TypeError, ValueError):
        return default

def _safe_float(v, default=0.0):
    try:
        f = float(str(v).replace(",","").strip())
        return f if math.isfinite(f) else default
    except (TypeError, ValueError):
        return default

def load_polygon(path):
    with open(path) as f:
        gj = json.load(f)
    geom = shape(gj["features"][0]["geometry"])
    if not geom.is_valid:
        geom = make_valid(geom)
    return geom


def load_parcels(raw_path, city_geom):
    print("  Loading raw parcel file...")
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
            p   = feat["properties"]
            rec = {
                "tms":       str(p.get("TMS") or ""),
                "loc":       str(p.get("LOC") or "").strip().upper(),
                "name1":     str(p.get("NAME1") or "").strip().upper(),
                "name2":     str(p.get("NAME2") or "").strip().upper(),
                "owner":     str(p.get("OwnerAll") or p.get("NAME1") or "").strip().upper(),
                "mail_addr": str(p.get("ADDRESS1") or "").strip().upper(),
                "mail_city": str(p.get("CITY") or "").strip().upper().rstrip(","),
                "mail_state":str(p.get("STATE") or "").strip().upper(),
                "mail_zip":  str(p.get("ZIPCODE") or "").strip(),
                "pca":       str(p.get("PCA") or "").strip(),
                "iv":        str(p.get("I_V") or "").strip(),
                "taxarea":   str(p.get("TAXAREA") or "").strip(),
                "exemption1":str(p.get("Exemption1") or "").strip(),
                "assessed":  _safe_int(p.get("TotalMarket") or p.get("Total_Mkt_")),
                "land_val":  _safe_int(p.get("Market_Land") or p.get("Mkt_Val_La")),
                "acres":     _safe_float(p.get("Acres") or p.get("acreage")),
                "sale_price":_safe_int(p.get("SALEPRICE")),
                "sale_date": str(p.get("SALEDATE") or ""),
                "centroid_lon": round(c.x, 6),
                "centroid_lat": round(c.y, 6),
                "_geometry":    geom_raw,
            }
            records.append(rec)
        except Exception:
            skipped += 1

    print(f"  Inside polygon: {len(records):,} | Skipped: {skipped:,}")
    return records


# ──────────────────────────────────────────────────────────────────────────────
# OWNERSHIP CLASSIFICATION
# ──────────────────────────────────────────────────────────────────────────────

def is_corporate(owner_name):
    if not owner_name:
        return False
    return bool(CORP_RE.search(owner_name)) and not FAMILY_TRUST_PATTERN.search(owner_name)


def normalize_address(addr, city, state, zipcode):
    """Normalize a mailing address for portfolio clustering."""
    parts = [
        addr.strip().upper(),
        city.strip().upper().rstrip(","),
        state.strip().upper(),
        zipcode.strip()[:5],
    ]
    return " | ".join(p for p in parts if p and p not in ("", "NONE", "N/A"))


def classify_owner(rec):
    """Return owner_type string."""
    # 1. Legal residence = owner-occupied by SC law
    if rec["pca"] == ".04":
        return "Owner-Occupied"
    # 2. Civic/exempt
    if rec["exemption1"].startswith("EX"):
        return "Civic / Exempt"
    # 3. Corporate / LLC
    if is_corporate(rec["owner"]):
        return "Corporate / LLC"
    # 4. Out-of-state (mailing address)
    if rec["mail_state"] and rec["mail_state"] != "SC":
        return "Out-of-State"
    # 5. Absentee local — mailing address differs from property address
    mail_num  = rec["mail_addr"].split()[0] if rec["mail_addr"] else ""
    prop_num  = rec["loc"].split()[0] if rec["loc"] else ""
    mail_base = rec["mail_addr"][:20] if rec["mail_addr"] else ""
    prop_base = rec["loc"][:20] if rec["loc"] else ""
    if mail_base and prop_base and mail_base != prop_base:
        return "Local Absentee"
    return "Owner-Occupied"


def build_portfolios(records):
    """Group parcels by normalized mailing address to find portfolio owners."""
    addr_groups = defaultdict(list)
    for rec in records:
        if rec["owner_type"] in ("Civic / Exempt", "Owner-Occupied"):
            continue
        norm = normalize_address(
            rec["mail_addr"], rec["mail_city"],
            rec["mail_state"], rec["mail_zip"]
        )
        if norm:
            addr_groups[norm].append(rec)

    portfolios = []
    for addr, recs in addr_groups.items():
        if len(recs) < 2:
            continue
        owners = Counter(r["owner"] for r in recs).most_common(1)
        total_val = sum(r["assessed"] for r in recs)
        total_acres = sum(r["acres"] for r in recs)
        types = Counter(r["owner_type"] for r in recs)
        portfolios.append({
            "mailing_address": addr,
            "display_name":    owners[0][0] if owners else addr,
            "n_parcels":       len(recs),
            "total_assessed":  total_val,
            "total_acres":     round(total_acres, 2),
            "dominant_type":   types.most_common(1)[0][0],
            "parcel_ids":      ",".join(r["tms"] for r in recs[:10]),
        })

    portfolios.sort(key=lambda x: -x["n_parcels"])
    return portfolios


def tag_portfolio_size(rec, addr_to_portfolio):
    norm = normalize_address(
        rec["mail_addr"], rec["mail_city"],
        rec["mail_state"], rec["mail_zip"]
    )
    portfolio = addr_to_portfolio.get(norm)
    if portfolio:
        n = portfolio["n_parcels"]
        if n >= 50:   return "Mega portfolio (50+)"
        if n >= 20:   return "Large portfolio (20–49)"
        if n >= 10:   return "Mid portfolio (10–19)"
        if n >= 3:    return "Small portfolio (3–9)"
    return ""


# ──────────────────────────────────────────────────────────────────────────────
# OUTPUT
# ──────────────────────────────────────────────────────────────────────────────

PARCEL_FIELDS = [
    "tms","loc","owner","owner_type","portfolio_size",
    "mail_addr","mail_city","mail_state","mail_zip",
    "pca","iv","assessed","land_val","acres","sale_price","sale_date",
    "taxarea","exemption1","centroid_lon","centroid_lat",
]

PORTFOLIO_FIELDS = [
    "display_name","mailing_address","n_parcels","total_assessed",
    "total_acres","dominant_type","parcel_ids",
]


def save_csvs(records, portfolios, output_dir, slug):
    p_path = os.path.join(output_dir, f"{slug}_investor_parcels.csv")
    with open(p_path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=PARCEL_FIELDS)
        w.writeheader()
        for r in records:
            w.writerow({k: r.get(k,"") for k in PARCEL_FIELDS})
    print(f"  Saved: {p_path}")

    pf_path = os.path.join(output_dir, f"{slug}_investor_portfolios.csv")
    with open(pf_path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=PORTFOLIO_FIELDS)
        w.writeheader()
        for r in portfolios:
            w.writerow({k: r.get(k,"") for k in PORTFOLIO_FIELDS})
    print(f"  Saved: {pf_path}")


def build_dashboard(records, portfolios, city_name, output_dir, slug):
    # Summary counts
    type_counts = Counter(r["owner_type"] for r in records)
    type_val    = defaultdict(int)
    for r in records:
        type_val[r["owner_type"]] += r["assessed"]
    total_val = sum(r["assessed"] for r in records) or 1

    # Color map
    TYPE_COLORS = {
        "Owner-Occupied":       "#4A7A5C",
        "Corporate / LLC":      "#8B1A1A",
        "Out-of-State":         "#D4501F",
        "Local Absentee":       "#445B7A",
        "Civic / Exempt":       "#7A7A9A",
    }

    # All non-OO parcels for the map (cap at 15k for render speed)
    map_recs = [r for r in records if r["owner_type"] != "Owner-Occupied"]
    import random
    if len(map_recs) > 12000:
        map_recs = random.sample(map_recs, 12000)

    map_feats = []
    for r in map_recs:
        if not r.get("_geometry"): continue
        map_feats.append({
            "type": "Feature",
            "geometry": r["_geometry"],
            "properties": {
                "type":      r["owner_type"],
                "owner":     r["owner"][:60],
                "loc":       r["loc"],
                "assessed":  r["assessed"],
                "acres":     r["acres"],
                "portfolio": r.get("portfolio_size",""),
                "mail_state":r["mail_state"],
            },
        })
    map_gj = json.dumps({"type":"FeatureCollection","features":map_feats},
                        separators=(",",":"))

    # Chart data — ownership type breakdown
    type_order = ["Owner-Occupied","Corporate / LLC","Out-of-State","Local Absentee","Civic / Exempt"]
    type_chart_js = json.dumps([{
        "type":  t,
        "count": type_counts.get(t, 0),
        "pct_n": round(type_counts.get(t,0)/len(records)*100, 1),
        "pct_v": round(type_val.get(t,0)/total_val*100, 1),
        "color": TYPE_COLORS.get(t,"#aaa"),
    } for t in type_order if type_counts.get(t,0)], separators=(",",":"))

    # Top 30 portfolios table
    top_portfolios = portfolios[:30]
    def _fmt_m(v):
        if v >= 1_000_000: return f"${v/1_000_000:.1f}M"
        return f"${v/1_000:.0f}K"

    port_rows = "\n".join(
        "<tr><td>{}</td><td>{}</td><td>{}</td><td>{:.1f}</td><td>{}</td><td style='font-size:10px;color:#7A7A7A'>{}</td></tr>".format(
            p["display_name"][:50], p["n_parcels"], _fmt_m(p["total_assessed"]),
            p["total_acres"], p["dominant_type"], p["mailing_address"][:45]
        )
        for p in top_portfolios
    )

    # Out-of-state buyer geographic breakdown
    oos = [r for r in records if r["owner_type"] == "Out-of-State"]
    oos_states = Counter(r["mail_state"] for r in oos if r["mail_state"] not in ("","SC"))
    oos_js = json.dumps([{"state":s,"count":c} for s,c in oos_states.most_common(12)],
                        separators=(",",":"))

    # Map center
    lons = [r["centroid_lon"] for r in records if r["centroid_lon"]]
    lats = [r["centroid_lat"] for r in records if r["centroid_lat"]]
    cx = sum(lons)/len(lons) if lons else -81.03
    cy = sum(lats)/len(lats) if lats else 34.00

    n_total = len(records)
    n_corp  = type_counts.get("Corporate / LLC", 0)
    n_oos   = type_counts.get("Out-of-State", 0)
    n_abst  = type_counts.get("Local Absentee", 0)
    n_civic = type_counts.get("Civic / Exempt", 0)
    n_oo    = type_counts.get("Owner-Occupied", 0)
    pct_inv = round((n_corp + n_oos + n_abst) / n_total * 100, 1)

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{city_name} — Investor & Ownership Analysis</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700;900&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>
<style>
:root{{--bg:#FAF7F2;--bg-card:#fff;--ink:#1A1A1A;--ink-soft:#404040;--ink-mute:#7A7A7A;--line:#E5DFD3;}}
*{{box-sizing:border-box;margin:0;padding:0}}
body{{background:var(--bg);color:var(--ink);font-family:Inter,sans-serif;font-size:14px}}
.header{{background:var(--ink);color:#fff;padding:32px 40px}}
.kicker{{font-size:11px;letter-spacing:.12em;text-transform:uppercase;opacity:.6;margin-bottom:8px}}
.headline{{font-family:'Playfair Display',serif;font-size:34px;font-weight:900;margin-bottom:8px}}
.subtitle{{font-size:14px;opacity:.7}}
.ribbon{{display:flex;gap:1px;background:var(--line);border-bottom:1px solid var(--line)}}
.stat{{flex:1;background:var(--bg-card);padding:18px 20px;text-align:center}}
.stat-val{{font-family:'Playfair Display',serif;font-size:28px;font-weight:700}}
.stat-lbl{{font-size:11px;color:var(--ink-mute);margin-top:4px}}
.body{{display:flex;height:560px}}
#map{{flex:3}}
.panel{{flex:2;overflow-y:auto;background:var(--bg-card);border-left:1px solid var(--line);padding:16px}}
.panel h3{{font-family:'Playfair Display',serif;font-size:15px;margin-bottom:10px;color:#8B1A1A}}
.legend{{display:flex;flex-direction:column;gap:6px;margin-bottom:14px}}
.leg-item{{display:flex;align-items:center;gap:6px;font-size:12px}}
.leg-sw{{width:16px;height:16px;border-radius:3px;flex-shrink:0}}
table{{width:100%;border-collapse:collapse;font-size:11px}}
th{{text-align:left;padding:4px 6px;font-size:10px;color:var(--ink-mute);border-bottom:1px solid var(--line)}}
td{{padding:4px 6px;border-bottom:1px solid var(--line)}}
tr:hover td{{background:#f5f0ea}}
.ctrl-bar{{position:absolute;top:8px;right:8px;z-index:1000;background:rgba(255,255,255,.95);
  border:1px solid var(--line);border-radius:6px;padding:6px 10px;box-shadow:0 2px 8px rgba(0,0,0,.12);
  display:flex;gap:6px}}
.ctrl-btn{{font-size:11px;background:none;border:1px solid var(--line);border-radius:4px;
  padding:3px 8px;cursor:pointer;transition:all .15s}}
.ctrl-btn.active{{background:#8B1A1A;color:#fff;border-color:#8B1A1A}}
.charts{{display:flex;gap:20px;padding:20px 28px;background:var(--bg-card);border-top:1px solid var(--line)}}
.chart-wrap{{flex:1}}
.chart-wrap h4{{font-family:'Playfair Display',serif;font-size:14px;margin-bottom:8px}}
.ctx{{padding:20px 28px;font-size:13px;line-height:1.7;color:var(--ink-soft);border-top:1px solid var(--line)}}
.ctx p{{margin-bottom:10px}}
footer{{padding:14px 28px;font-size:11px;color:var(--ink-mute);border-top:1px solid var(--line)}}
</style>
</head>
<body>

<div class="header">
  <div class="kicker">Ownership & Investor Analysis · {datetime.now().strftime('%B %Y')}</div>
  <div class="headline">{city_name} — Who Owns the City?</div>
  <div class="subtitle">Mapping corporate landlords, out-of-state buyers, and absentee ownership</div>
</div>

<div class="ribbon">
  <div class="stat"><div class="stat-val">{n_total:,}</div><div class="stat-lbl">Total parcels</div></div>
  <div class="stat"><div class="stat-val" style="color:#4A7A5C">{n_oo:,}</div><div class="stat-lbl">Owner-occupied</div></div>
  <div class="stat"><div class="stat-val" style="color:#8B1A1A">{n_corp:,}</div><div class="stat-lbl">Corporate / LLC</div></div>
  <div class="stat"><div class="stat-val" style="color:#D4501F">{n_oos:,}</div><div class="stat-lbl">Out-of-state</div></div>
  <div class="stat"><div class="stat-val" style="color:#445B7A">{n_abst:,}</div><div class="stat-lbl">Local absentee</div></div>
  <div class="stat"><div class="stat-val">{pct_inv}%</div><div class="stat-lbl">Non-owner-occupied</div></div>
</div>

<div class="body">
  <div id="map" style="position:relative">
    <div class="ctrl-bar">
      <button class="ctrl-btn active" id="btn-all" onclick="setFilter('all')">All</button>
      <button class="ctrl-btn" id="btn-corp" onclick="setFilter('Corporate / LLC')">Corp/LLC</button>
      <button class="ctrl-btn" id="btn-oos" onclick="setFilter('Out-of-State')">OOS</button>
      <button class="ctrl-btn" id="btn-abst" onclick="setFilter('Local Absentee')">Absentee</button>
    </div>
  </div>
  <div class="panel">
    <h3>Top Portfolio Landlords</h3>
    <table>
      <thead>
        <tr><th>Owner / Entity</th><th>#</th><th>Value</th><th>Acres</th><th>Type</th><th>Mailing Address</th></tr>
      </thead>
      <tbody>{port_rows}</tbody>
    </table>
    <br>
    <div class="legend">
      <div class="leg-item"><div class="leg-sw" style="background:#4A7A5C"></div> Owner-Occupied (legal residence)</div>
      <div class="leg-item"><div class="leg-sw" style="background:#8B1A1A"></div> Corporate / LLC</div>
      <div class="leg-item"><div class="leg-sw" style="background:#D4501F"></div> Out-of-State Individual</div>
      <div class="leg-item"><div class="leg-sw" style="background:#445B7A"></div> Local Absentee</div>
      <div class="leg-item"><div class="leg-sw" style="background:#7A7A9A"></div> Civic / Exempt</div>
    </div>
  </div>
</div>

<div class="charts">
  <div class="chart-wrap">
    <h4>Ownership breakdown — share of parcels vs. assessed value</h4>
    <div id="chartTypes" style="height:240px"></div>
  </div>
  <div class="chart-wrap">
    <h4>Out-of-state buyers by mailing state</h4>
    <div id="chartOOS" style="height:240px"></div>
  </div>
</div>

<div class="ctx">
  <p><strong>Methodology:</strong> Owner-occupied = SC legal residence exemption (PCA=.04) on file with county assessor.
  Corporate/LLC = entity name contains incorporation keywords (LLC, Corp, Holdings, etc.), excluding revocable living trusts.
  Out-of-state = mailing address in a state other than SC.
  Local absentee = SC mailing address that differs from property address.
  Portfolio detection: entities sharing a mailing address and owning 2+ parcels are grouped as portfolios.</p>
  <p><strong>Known caveats:</strong> Some LLC-owned parcels may be owner-occupied (a common asset protection structure).
  The corporate keyword list misses creative corporate naming and informal LLCs registered under personal names.
  Mailing address matching is imperfect — P.O. boxes and property managers can create false positives.
  This analysis is a first-pass screen; individual verification is needed before publishing claims about specific owners.</p>
  <p><strong>Data:</strong> Richland County SCDOT parcel data, {n_total:,} parcels inside Columbia city limits (TIGER boundary).</p>
</div>

<footer>
  Jimmy Ardis · Carolina Redesign · Run date: {datetime.now().strftime('%Y-%m-%d')}
</footer>

<script>
const PARCELS = {map_gj};
const TYPE_COLORS = {json.dumps(TYPE_COLORS, separators=(",",":"))};
const TYPE_DATA = {type_chart_js};
const OOS_DATA = {oos_js};

let activeFilter = 'all';
let parcelLayer = null;

const map = L.map('map',{{zoomControl:true,preferCanvas:true,scrollWheelZoom:true,attributionControl:false}})
  .setView([{cy:.4f},{cx:.4f}],12);
L.tileLayer('https://{{s}}.basemaps.cartocdn.com/light_nolabels/{{z}}/{{x}}/{{y}}{{r}}.png',
  {{maxZoom:19,subdomains:'abcd'}}).addTo(map);
L.tileLayer('https://{{s}}.basemaps.cartocdn.com/light_only_labels/{{z}}/{{x}}/{{y}}{{r}}.png',
  {{maxZoom:19,subdomains:'abcd',pane:'shadowPane'}}).addTo(map);

function drawLayer() {{
  if(parcelLayer) map.removeLayer(parcelLayer);
  const filtered = activeFilter==='all'
    ? PARCELS
    : {{...PARCELS, features:PARCELS.features.filter(f=>f.properties.type===activeFilter)}};
  parcelLayer = L.geoJSON(filtered,{{
    style:f=>{{
      const c = TYPE_COLORS[f.properties.type]||'#aaa';
      const isPortfolio = f.properties.portfolio && f.properties.portfolio!=='';
      return {{color:isPortfolio?'#fff':'#2A2A2A',weight:isPortfolio?1:0.3,
               fillColor:c,fillOpacity:0.78}};
    }},
    onEachFeature:(f,layer)=>{{
      const p=f.properties;
      layer.bindPopup(`<div style="font-family:Inter,sans-serif;font-size:12px;min-width:200px">
        <b>${{p.loc||'(no address)'}}</b><hr style="margin:5px 0;border-color:#E5DFD3">
        <b>Owner:</b> ${{p.owner}}<br>
        <b>Type:</b> <span style="color:${{TYPE_COLORS[p.type]||'#aaa'}}">${{p.type}}</span><br>
        ${{p.portfolio?'<b>Portfolio:</b> '+p.portfolio+'<br>':''}}
        ${{p.mail_state&&p.mail_state!='SC'?'<b>Mailing state:</b> '+p.mail_state+'<br>':''}}
        <b>Assessed:</b> $${{(p.assessed||0).toLocaleString()}}<br>
        <b>Acres:</b> ${{(p.acres||0).toFixed(3)}}
      </div>`);
    }}
  }}).addTo(map);
}}
drawLayer();

window.setFilter = function(f) {{
  activeFilter = f;
  ['btn-all','btn-corp','btn-oos','btn-abst'].forEach(id=>
    document.getElementById(id).classList.remove('active'));
  const btnMap={{'all':'btn-all','Corporate / LLC':'btn-corp','Out-of-State':'btn-oos','Local Absentee':'btn-abst'}};
  if(btnMap[f]) document.getElementById(btnMap[f]).classList.add('active');
  drawLayer();
}};

// Type breakdown chart
echarts.init(document.getElementById('chartTypes')).setOption({{
  grid:{{left:140,right:80,top:12,bottom:12}},
  xAxis:[
    {{type:'value',max:100,axisLabel:{{formatter:v=>v+'%'}},name:'parcels %',nameLocation:'middle',nameGap:20}},
  ],
  yAxis:{{type:'category',data:TYPE_DATA.map(d=>d.type),axisTick:{{show:false}}}},
  series:[
    {{name:'Parcels',type:'bar',data:TYPE_DATA.map(d=>d.pct_n),
      itemStyle:{{color:d=>TYPE_DATA[d.dataIndex].color,opacity:0.9}},
      label:{{show:true,position:'right',formatter:p=>p.data+'%'}}}},
  ],
  legend:{{show:false}},
  tooltip:{{formatter:p=>`${{TYPE_DATA[p.dataIndex].type}}<br>Parcels: ${{TYPE_DATA[p.dataIndex].count.toLocaleString()}} (${{p.data}}%)<br>Value share: ${{TYPE_DATA[p.dataIndex].pct_v}}%`}},
}});

// OOS states chart
echarts.init(document.getElementById('chartOOS')).setOption({{
  grid:{{left:40,right:20,top:12,bottom:48}},
  xAxis:{{type:'category',data:OOS_DATA.map(d=>d.state),axisLabel:{{rotate:40}}}},
  yAxis:{{type:'value',name:'parcels',nameTextStyle:{{fontSize:10}}}},
  series:[{{type:'bar',data:OOS_DATA.map(d=>d.count),
    itemStyle:{{color:'#D4501F',opacity:0.85}},
    label:{{show:true,position:'top',fontSize:10}}}}],
  tooltip:{{trigger:'axis',formatter:p=>`${{p[0].name}}: ${{p[0].value}} parcels`}},
}});
</script>
</body>
</html>"""

    path = os.path.join(output_dir, f"{slug}_investor_dashboard.html")
    with open(path, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"  Saved: {path}")


# ──────────────────────────────────────────────────────────────────────────────
# MAIN
# ──────────────────────────────────────────────────────────────────────────────

def main():
    p = argparse.ArgumentParser(description="Investor & Ownership Analysis")
    p.add_argument("--raw",        required=True)
    p.add_argument("--polygon",    required=True)
    p.add_argument("--output-dir", required=True)
    p.add_argument("--slug",       default="")
    p.add_argument("--city-name",  default="City")
    args = p.parse_args()

    slug = args.slug or os.path.basename(args.raw).replace("_raw.geojson","")
    os.makedirs(args.output_dir, exist_ok=True)

    print(f"\n[1] Loading city polygon...")
    city_geom = load_polygon(args.polygon)

    print(f"\n[2] Loading and filtering parcels...")
    records = load_parcels(args.raw, city_geom)

    print(f"\n[3] Classifying ownership...")
    for rec in records:
        rec["owner_type"] = classify_owner(rec)

    print(f"\n[4] Building portfolio groups...")
    addr_to_portfolio = {}
    portfolios = build_portfolios(records)
    for port in portfolios:
        for tms in port["parcel_ids"].split(","):
            pass  # we'll tag by address match below
    # Build lookup by normalized address
    for port in portfolios:
        addr_to_portfolio[port["mailing_address"]] = port

    for rec in records:
        rec["portfolio_size"] = tag_portfolio_size(rec, addr_to_portfolio)

    # Summary
    type_counts = Counter(r["owner_type"] for r in records)
    n = len(records)
    print(f"\n{'─'*60}")
    print(f"  {args.city_name} — Ownership Summary")
    for t, c in type_counts.most_common():
        print(f"  {t:30s}: {c:6,}  ({100*c/n:.1f}%)")
    print(f"  Portfolio landlords (2+ parcels): {len(portfolios):,}")
    if portfolios:
        top = portfolios[0]
        print(f"  Largest portfolio: {top['display_name'][:40]} ({top['n_parcels']} parcels, "
              f"${top['total_assessed']:,} value)")
    print(f"{'─'*60}")

    print(f"\n[5] Saving CSVs...")
    save_csvs(records, portfolios, args.output_dir, slug)

    print(f"\n[6] Building dashboard...")
    build_dashboard(records, portfolios, args.city_name, args.output_dir, slug)

    print(f"\n✓ Investor analysis complete.")


if __name__ == "__main__":
    main()
