# Walled City Pipeline — Methodology Spec

**A reproducible pipeline for analyzing the per-acre property-tax productivity of any defined geography, using public county GIS data, the Strong Towns / Urban3 framework, and a consistent editorial output shape.**

Written for Claude Code. Designed so that, given a town name (or county, or boundary polygon), the pipeline can:

1. Acquire parcel data from the county's public ArcGIS REST endpoint
2. Apply per-parcel tax math (SC 4%/6% assessment ratios × combined millage − LOST credit where applicable)
3. Compute the derived metrics that make the per-acre productivity argument legible
4. Save a canonical 5-file output bundle
5. Optionally build an interactive editorial dashboard

The canonical worked example throughout this document is the **Charleston Walled City** (the 1704 enceinte bounded by Meeting, Cumberland, East Bay, and Water Streets — 73.7 acres, 831 parcels). A scaling section at the end shows how the same pipeline extended to CENA, West Ashley, Chapin proper, Greater Chapin, and Charleston citywide without structural change.

---

## 1. Mission and Output Contract

### What this pipeline produces

For any bounded geography, six artifacts:

| File | Shape | Purpose |
|---|---|---|
| `{name}_polygon.geojson` | FeatureCollection with 1 feature (Polygon or MultiPolygon) | The analysis boundary with metadata |
| `{name}_raw.geojson` | FeatureCollection of all parcels intersecting the bbox | Untouched ArcGIS REST response, for debugging |
| `{name}_data.geojson` | FeatureCollection of parcels with centroid inside polygon, enriched with all canonical fields and derived metrics | The primary output, ready for Mapbox upload or inline dashboard |
| `{name}_slim.geojson` | Same as above but with simplified geometries and reduced properties | Inline dashboard use when full file exceeds 20 MB |
| `{name}_summary.json` | Single aggregate record per area | Headline numbers for narration / VAPI knowledge base |
| `{name}_parcels.csv` | Tabular parcel-level data | Spreadsheet downstream use |
| `{name}_dashboard.html` (optional) | Self-contained HTML with Leaflet + ECharts | Editorial visualization |

### What success looks like

When the pipeline runs successfully on a new geography, you should be able to answer the following questions from the outputs alone:

- How many parcels are inside the polygon?
- What is the total appraised value?
- What is the total estimated annual property tax?
- What is the tax per polygon acre, and per taxable acre?
- What share of the land is civic / tax-exempt vs. taxable vs. street ROW?
- What is the use mix by acreage and by value?
- Which parcels produce the most tax per acre (the top performers)?
- What is the land-to-improvement ratio (the Detroit-problem indicator)?

If any of those cannot be answered, the run is incomplete.

---

## 2. Inputs Required

### From the user

At minimum:

- **Geography name** (e.g., "Charleston Walled City", "Town of Chapin", "I'On at Mt. Pleasant")
- **State** (e.g., "SC")
- **County** or **counties** the geography spans

Optionally:

- **Polygon definition**: explicit lat/lon vertex list, or "use Census TIGER place GEOID X", or "use the rectangle bounded by streets W/N/E/S", or "use these census tracts"
- **Millage and assessment ratio overrides** if the defaults aren't right
- **Sub-area splits** for comparative analysis (e.g., "split the town into downtown vs. outside")
- **Brand attribution** for the dashboard (default: Jimmy Ardis · Carolina Redesign)

### Fixed defaults the pipeline supplies

For SC analyses:

- Owner-occupied assessment ratio: **4%** (SC Code Ann. § 12-43-220)
- Other property assessment ratio: **6%**
- Other categories (10.5% manufacturing, etc.) are noted but rarely material for residential/commercial productivity analysis

If the geography is outside SC, the pipeline must ask the user for the appropriate assessment ratios and tax formula.

### What to do if the user provides only a name

Sequence:

1. Resolve the geography to a polygon. Try in this order:
   - Census TIGER Incorporated Places (works for any incorporated municipality)
   - Census TIGER tract union (works for "Greater X" or "Census-defined X")
   - Charleston County's parcel-address centroids (works for "the area bounded by streets W/N/E/S")
   - Ask the user to provide vertices if none of the above resolve

2. Resolve the county. From the polygon's centroid, infer county FIPS via TIGERweb State_County service.

3. Find the county's parcel REST endpoint. Try common patterns first (`maps.{county}.gov`, `gis.{county}.com`, `arcgis.{county}.com`), then search.

4. Find the millage card. Usually at `{county}.gov/auditor` or similar.

---

## 3. Boundary Definition — Three Patterns

### Pattern A: Census TIGER Place (incorporated municipality)

Best when the geography is an incorporated city or town.

```python
import requests, json

# TIGERweb Places (Incorporated Places, current vintage = layer 4)
url = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/4/query"
params = {
    "where": "BASENAME='Charleston' AND STATE='45'",   # 'Charleston city' is the NAME
    "outFields": "NAME,GEOID,STATE,PLACE,BASENAME",
    "returnGeometry": "true",
    "outSR": "4326",
    "f": "geojson",
}
r = requests.get(url, params=params, headers={"User-Agent": "Mozilla/5.0"}, timeout=60)
place = r.json()
# Returns 1 feature, geometry is usually MultiPolygon for large cities
```

Use the **BASENAME** filter, not NAME — NAME has the suffix "city" or "town" while BASENAME is just the place name.

The geometry returned is typically a MultiPolygon for cities that span multiple disjoint annexations (Charleston city has 71 disjoint parts).

### Pattern B: Census TIGER Tract Union

Best when the geography is "Greater X" — a metro fringe defined by census tracts rather than incorporation.

```python
# Buffer around a center point, then query tracts that intersect
center_lat, center_lon = 34.165, -81.339
radius_deg = 0.101  # ~7 miles in latitude degrees

# Build a circular buffer polygon (counterclockwise outer ring)
import math
n = 36
buffer_pts = []
for i in range(n + 1):
    a = i * 2 * math.pi / n
    lat = center_lat + radius_deg * math.cos(a)
    lon = center_lon + radius_deg / math.cos(math.radians(center_lat)) * math.sin(a)
    buffer_pts.append([lon, lat])

geom = {"rings": [buffer_pts], "spatialReference": {"wkid": 4326}}
url = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/0/query"
data = {
    "geometry": json.dumps(geom),
    "geometryType": "esriGeometryPolygon",
    "inSR": "4326",
    "spatialRel": "esriSpatialRelIntersects",
    "outFields": "GEOID,STATE,COUNTY,TRACT,NAME,BASENAME",
    "outSR": "4326",
    "f": "geojson",
}
r = requests.post(url, data=data, headers={"User-Agent": "Mozilla/5.0"}, timeout=60)
tracts = r.json()

# IMPORTANT: drop tracts whose centroid is more than the radius from center.
# Census tracts can extend far beyond their nominal "intersection" with the buffer.
# Filter to tracts whose CENTROID is within the radius, not just whose edge touches.
```

After filtering, union the kept tracts into a single polygon using `shapely.ops.unary_union`.

### Pattern C: Manual Street Rectangle from Parcel Centroids

Best when the geography is defined by streets (e.g., "the four blocks bounded by Meeting, Cumberland, East Bay, and Water").

Query the county for parcels addressed on each boundary street, then take the extremes:

```python
# Pull parcels named on each boundary street
def find_street_extent(county_url, street_name, lat_range, lon_range):
    params = {
        "where": f"UPPER(PROP_ST_NAME)='{street_name.upper()}'",
        "outFields": "PROP_ST_NO,PROP_ST_NAME",
        "returnGeometry": "true",
        "outSR": "4326",
        "f": "geojson",
        "resultRecordCount": 500,
    }
    r = requests.get(county_url, params=params, timeout=60,
                     headers={"User-Agent": "Mozilla/5.0"})
    feats = r.json().get("features", [])
    centroids = []
    from shapely.geometry import shape
    for f in feats:
        c = shape(f["geometry"]).centroid
        if lat_range[0] <= c.y <= lat_range[1] and lon_range[0] <= c.x <= lon_range[1]:
            centroids.append((c.x, c.y))
    return centroids
```

Then build a polygon with corners at the intersections of the four bounding streets.

The Charleston Walled City polygon was built this way:

```python
walled_city_coords = [
    [-79.9311, 32.7731],   # SW = Meeting & Water
    [-79.9271, 32.7731],   # SE = East Bay & Water
    [-79.9264, 32.7800],   # NE = East Bay & Cumberland (East Bay curves east at top)
    [-79.9311, 32.7794],   # NW = Meeting & Cumberland
    [-79.9311, 32.7731],   # close ring
]
```

### Saving the polygon

Always save the polygon as GeoJSON with descriptive metadata:

```python
poly = {
    "type": "FeatureCollection",
    "features": [{
        "type": "Feature",
        "properties": {
            "name": "Charleston Walled City",
            "short": "Walled City",
            "color": "#6B1F00",
            "description": "Original 1704 enceinte bounded by Meeting, Cumberland, East Bay, and Water Streets. ~73 acres on the modern street footprint; 62 acres on the historic 1721 Herbert plan.",
        },
        "geometry": {"type": "Polygon", "coordinates": [walled_city_coords]},
    }],
}
```

---

## 4. County GIS Probing

Before pulling parcel data, verify the endpoint is alive and find the parcel layer.

### Step 1: Verify the service is up

```bash
curl -sL "{county_rest_root}?f=json" -H "User-Agent: Mozilla/5.0" | head -c 500
```

If you get HTML or a 500 error, the service is down or the URL is wrong. Try the parent directory and look for a `services` list.

```bash
# Example: when /PropertyParcel/MapServer fails, check the root services
curl -sL "https://map.newberrycounty.net/gis/rest/services?f=json" -H "User-Agent: Mozilla/5.0"
```

If the service genuinely doesn't exist publicly (Newberry County, SC is an example we encountered), **document the gap and proceed without that county**. Do not fabricate. Either skip the geography, narrow the scope, or use a third-party parcel aggregator (Regrid, ATTOM) if licensed.

### Step 2: Read the parcel layer's metadata

```bash
curl -sL "{parcel_layer_url}?f=json" -H "User-Agent: Mozilla/5.0"
```

Look for:

- `name`: confirms it's a parcel layer
- `type`: should be "Feature Layer"
- `geometryType`: should be "esriGeometryPolygon"
- `capabilities`: must include "Query"
- `maxRecordCount`: usually 1000 — this is your page size for pagination
- `fields`: the schema you need to map

Worked example — Charleston County's `CDC_ParcelMap/MapServer/0`:

```python
url = "https://gisccapps.charlestoncounty.org/arcgis/rest/services/CDC/CDC_ParcelMap/MapServer/0"
# Layer name: "Parcels"
# Geometry: esriGeometryPolygon
# Capabilities: Map,Query,Data
# Spatial reference: wkid 2273 (NAD83 SC State Plane feet)
# Returns geometry in 4326 (WGS84) when outSR=4326 is set in the query
# Fields: 48 of them, including OBJECTID, PID, OWNER1, PROP_ST_NO,
#   PROP_ST_NAME, LEGAL_RESIDENCE, CLASS_CODE, ACRES_CAL, LAND_APPR,
#   IMP_APPR, APPRAISAL, SALE_PRICE, TAX_DISTRICT, etc.
```

Worked example — Lexington County's `Property/MapServer/4`:

```python
url = "https://maps.lex-co.com/agstserver/rest/services/Property/MapServer/4"
# Layer name: "Parcels"
# Geometry: esriGeometryPolygon
# Spatial reference: wkid 2273
# Fields: similar concept, different names — TMS, Owner, PropAddr_Num,
#   PropAddr_Str, LR, PropTypeCode, Acres, TaxableLand, TaxableBldg,
#   MktTotal, SalePrice, TaxDist, etc.
```

### Step 3: Build a field adapter

See section 5 below for the canonical schema and how to map each county's fields.

---

## 5. Canonical Schema and Field Adapter

### The canonical schema

Every parcel in our `{name}_data.geojson` carries this exact set of properties:

| Field | Type | Source | Meaning |
|---|---|---|---|
| `area_short` | string | computed | Short name of the geography (e.g., "Walled City") |
| `pid` | string | county PID/TMS/PIN | Unique parcel identifier |
| `address` | string | county street fields | Formatted site address |
| `owner1` | string | county OWNER1/Owner | Primary owner name |
| `tax_district` | string | county TAX_DISTRICT/TaxDist | Tax district code (used to look up millage) |
| `class_code` | string | county CLASS_CODE/PropTypeCode | Use classification code (raw, county-specific) |
| `class_code_short` | string | computed | Just the numeric portion |
| `use_group` | string | computed via classifier | One of 7 canonical use groups (see section 6) |
| `legal_residence` | bool | county LR/LEGAL_RESIDENCE | True if owner-occupied (qualifies for 4% ratio) |
| `is_civic_exempt` | bool | computed | True if parcel pays no property tax (church, gov, school) |
| `acres_cal` | float | county ACRES_CAL/Acres | Parcel acreage from county GIS |
| `land_appr` | int | county LAND_APPR/TaxableLand | Appraised land value |
| `imp_appr` | int | county IMP_APPR/TaxableBldg | Appraised improvements (building) value |
| `appraisal` | int | county APPRAISAL/MktTotal | Total appraised market value |
| `value_per_acre` | float | computed | `appraisal / acres_cal` |
| `tax_per_acre` | float | computed | `est_tax_net / acres_cal` |
| `est_tax_gross` | float | computed | `appraisal × ratio × millage / 1000` |
| `est_tax_net` | float | computed | `gross_tax − LOST credit` (or 0 if civic) |
| `assessment_ratio` | float | computed | 0.04 or 0.06 based on legal_residence |
| `land_to_imp_ratio` | float | computed | `land_appr / imp_appr` (Detroit-problem indicator) |
| `sale_price` | int | county SalePrice/SALE_PRICE | Last recorded sale price (may be $0 or token amount for transfers) |
| `doc_date` | ISO date | county DOC_DATE/SaleDate | Last recorded transfer date |
| `centroid_lon` | float | computed | Geometry centroid longitude (WGS84) |
| `centroid_lat` | float | computed | Geometry centroid latitude (WGS84) |

### Adapter — Charleston County

```python
CHARLESTON_FIELD_MAP = {
    "pid":          "PID",                # also PARCEL_ID
    "owner":        "OWNER1",
    "st_no":        "PROP_ST_NO",
    "st_name":      "PROP_ST_NAME",
    "st_suf":       "PROP_TYPE",          # "ST", "AVE", "BLVD"
    "lr":           "LEGAL_RESIDENCE",    # "Y" or "N"
    "appraisal":    "APPRAISAL",
    "land_appr":    "LAND_APPR",
    "imp_appr":     "IMP_APPR",
    "acres":        "ACRES_CAL",
    "class_code":   "CLASS_CODE",         # 3-digit + label, e.g. "101 - RESID-SFR"
    "tax_dist":     "TAX_DISTRICT",       # e.g. "7-1", "6-3"
    "sale_price":   "SALE_PRICE",
    "sale_date":    "DOC_DATE",           # epoch milliseconds
}

# LR value to bool:
is_owner_occupied = (raw_lr == "Y")
```

### Adapter — Lexington County

```python
LEXINGTON_FIELD_MAP = {
    "pid":          "TMS",                # Tax Map Sheet
    "owner":        "Owner",
    "st_no":        "PropAddr_Num",
    "st_name":      "PropAddr_Str",
    "st_suf":       "PropAddr_Suf",
    "lr":           "LR",                 # "LR YES" or "LR NO"
    "appraisal":    "MktTotal",
    "land_appr":    "TaxableLand",
    "imp_appr":     "TaxableBldg",
    "acres":        "Acres",
    "class_code":   "PropTypeCode",       # 4-digit numeric, e.g. "1001"
    "tax_dist":     "TaxDist",            # e.g. "5C", "5"
    "sale_price":   "SalePrice",
    "sale_date":    "SaleDate",
}

# LR value to bool:
is_owner_occupied = (raw_lr == "LR YES")
```

### Building an adapter for a new county

```python
# After probing the parcel layer's fields, walk through the canonical schema
# and find the best-matching county field by name pattern.
def build_adapter(county_fields):
    candidates = {
        "owner":      ["Owner", "OWNER", "OWNER1", "OwnerName"],
        "st_no":      ["PROP_ST_NO", "PropAddr_Num", "SITUS_NO", "ADDR_NUM"],
        "st_name":    ["PROP_ST_NAME", "PropAddr_Str", "SITUS_STREET", "STREET"],
        "appraisal":  ["APPRAISAL", "MktTotal", "MarketValue", "TotalValue"],
        "land_appr":  ["LAND_APPR", "TaxableLand", "LandValue", "LAND_VAL"],
        "imp_appr":   ["IMP_APPR", "TaxableBldg", "BuildingValue", "BLDG_VAL"],
        "acres":      ["ACRES_CAL", "Acres", "ACRES", "Calc_Acres"],
        "class_code": ["CLASS_CODE", "PropTypeCode", "LandUseCode", "PROP_CLASS"],
        "pid":        ["PID", "TMS", "PIN", "PARCEL_ID", "TaxMapNum"],
        "tax_dist":   ["TAX_DISTRICT", "TaxDist", "TAX_DIST"],
        "lr":         ["LEGAL_RESIDENCE", "LR", "LegalRes", "OwnerOcc"],
        "sale_price": ["SALE_PRICE", "SalePrice"],
        "sale_date":  ["DOC_DATE", "SaleDate", "RECORDED_DATE"],
    }
    field_set = set(f["name"] for f in county_fields)
    adapter = {}
    for canon, candidates_list in candidates.items():
        for c in candidates_list:
            if c in field_set:
                adapter[canon] = c
                break
    return adapter
```

If a critical field (acres, appraisal, owner) is missing, **stop and ask the user** rather than synthesizing. Different states have very different data conventions.

---

## 6. Parcel Query — Pagination Pattern

### Use POST, not GET

ArcGIS REST query endpoints will return 404 or 414 when the URL exceeds ~4 KB (which happens fast once your polygon has 100+ vertices). Always POST:

```python
def query_parcels(rest_url, polygon_coords, page_size=1000):
    """Paginate through an ArcGIS REST parcel layer with a polygon filter."""
    geometry = {"rings": [polygon_coords], "spatialReference": {"wkid": 4326}}
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
    headers = {"User-Agent": "Mozilla/5.0 (compatible; CarolinaRedesign/1.0)"}
    while True:
        d = {**base, "resultRecordCount": page_size, "resultOffset": offset}
        r = requests.post(rest_url, data=d, timeout=300, headers=headers)
        if r.status_code != 200:
            raise RuntimeError(f"Query failed at offset {offset}: {r.status_code} {r.text[:200]}")
        page = r.json()
        feats = page.get("features", [])
        all_feats.extend(feats)
        # ArcGIS signals more pages either by returning a full page OR by
        # explicitly setting exceededTransferLimit=True
        exceeded = page.get("properties", {}).get("exceededTransferLimit", False)
        if len(feats) < page_size and not exceeded:
            break
        offset += page_size
        if offset > 200000:
            raise RuntimeError(f"Safety cap hit at offset {offset}")
    return all_feats
```

### Notes

- `User-Agent` header is required by some endpoints (Overpass API for OSM returns 406 without it; some county servers return 500)
- Set `timeout` generously — 300 seconds is reasonable for a single page query
- For very large polygons (citywide), prefer a bbox query and then filter by centroid-in-polygon downstream, rather than POSTing a 70-part multipolygon

---

## 7. Geometry Processing

### Use `shapely.prepared` for fast centroid-in-polygon at scale

For 10,000+ parcels, the naive `polygon.contains(point)` check is O(N) per query and quickly dominates runtime. Use `shapely.prepared.prep`:

```python
from shapely.geometry import shape, Point
from shapely.prepared import prep

city_geom = shape(polygon_geojson["geometry"])
prep_city = prep(city_geom)   # builds an indexed version for fast contains()

for feat in raw_features:
    geom = shape(feat["geometry"])
    if prep_city.contains(geom.centroid):
        # parcel is inside
        ...
```

This converts a 30-minute filter step into a 30-second one for citywide scale.

### Validate before unioning

Real-world parcel data is full of invalid geometries — self-intersections, slivers, duplicate vertices. `unary_union` will throw `TopologyException` on the first bad one.

```python
from shapely.validation import make_valid
from shapely.ops import unary_union

def safe_union(geoms):
    valid = []
    bad = 0
    for g in geoms:
        try:
            if not g.is_valid:
                g = make_valid(g)
            if not g.is_valid:
                g = g.buffer(0)   # the classic rescue path
            if g.is_valid and not g.is_empty:
                valid.append(g)
            else:
                bad += 1
        except Exception:
            bad += 1
    return unary_union(valid) if valid else None
```

### When to skip the union entirely

For more than ~50,000 parcels (Charleston citywide is 30K+ and is the borderline), the union step becomes a 10+ minute operation that risks running out of memory. In that case, skip it:

- Use **polygon area** (the bounded geography itself) as the per-acre denominator
- Sum `ACRES_CAL` for the parcel-acreage figure (noting that condos overcount their building footprint × unit count — this is acceptable for citywide aggregates because the overcounting is roughly uniform across patterns)
- Mark the methodology note: `"Parcel land breakdown skipped at this scale."`

---

## 8. Classification — Use Groups and Civic Detection

### The seven canonical use groups

Every parcel maps to exactly one of:

1. **Residential** — single-family, townhouse, condo, multi-family
2. **Commercial** — general commercial, retail, restaurant
3. **Specialty / condo** — small specialty residential, condo common areas
4. **Parking / ROW** — surface parking lots, road right-of-way parcels
5. **Office / Specialty** — office buildings, mixed-use commercial specialty
6. **Institutional / Civic** — government, religious, schools, museums (typically tax-exempt)
7. **Vacant / Other** — undeveloped land, agricultural, vacant lots

### Mapper for 3-digit codes (Charleston pattern)

```python
def use_group_charleston(code):
    if not code: return 'Other'
    c = ''.join(ch for ch in str(code) if ch.isdigit())
    if not c: return 'Other'
    ci = int(c[:3]) if len(c) >= 3 else int(c)
    if 100 <= ci < 200: return 'Residential'
    if 200 <= ci < 300: return 'Specialty / condo'
    if 400 <= ci < 500: return 'Parking / ROW'
    if 500 <= ci < 600: return 'Commercial'
    if 600 <= ci < 700: return 'Office / Specialty'
    if 700 <= ci < 800: return 'Institutional / Civic'
    if 900 <= ci < 1000: return 'Vacant / Other'
    return 'Other'
```

### Mapper for 4-digit codes (Lexington pattern)

```python
def use_group_lexington(code):
    if not code: return 'Other'
    c = str(code).strip()
    if c in ('1', '2', '3'): return 'Agricultural / Vacant'
    try: ci = int(c)
    except: return 'Other'
    if 9000 <= ci <= 9999: return 'Institutional / Civic'
    if 1001 <= ci <= 1019: return 'Residential SFR'
    if 1020 <= ci <= 1099: return 'Residential / Multi'
    if 1100 <= ci <= 2999: return 'Residential / Other'
    if 4000 <= ci <= 5999: return 'Commercial'
    if 6000 <= ci <= 6999: return 'Agricultural'
    if 9000 <= ci <= 9999: return 'Institutional / Civic'
    return 'Other'
```

### Civic / tax-exempt detection

Two signals:

```python
def is_civic_exempt(code, appraisal):
    if not code: return False
    c = ''.join(ch for ch in str(code) if ch.isdigit())
    if not c: return False
    ci = int(c[:3]) if len(c) >= 3 else int(c)
    # Charleston: 670-720 series
    if 670 <= ci <= 720: return True
    # ROW
    if ci == 451: return True
    # Lexington: 9xxx series
    if 9000 <= ci <= 9999: return True
    # Fallback: zero appraisal on an institutional code
    if appraisal == 0 and 600 <= ci < 800: return True
    return False
```

When `is_civic_exempt` is True, **set est_tax_net = 0** regardless of appraisal. These parcels carry a market value on the books but pay no property tax.

---

## 9. Tax Computation

### The SC formula

Per parcel:

```
gross_tax = appraisal × assessment_ratio × millage / 1000
lost_credit = appraisal × assessment_ratio × LOST_RATE
net_tax = max(0, gross_tax − lost_credit)
```

Where:

- `assessment_ratio` = 0.04 if `legal_residence`, else 0.06
- `millage` = combined county-plus-city-plus-school-plus-other mills (from the county auditor's millage card)
- `LOST_RATE` = 0.00090 for Charleston County (Local Option Sales Tax credit); 0 for Lexington County
- Civic-exempt parcels: `net_tax = 0` regardless

### Worked example — a residential parcel inside the Walled City

```
Parcel: 52 Meeting St
Appraisal: $984,500
Land: $654,600  Improvements: $329,900
Legal residence: No (owner-occupied flag = N)
Tax district: 7-1 (Charleston peninsula)
Millage: 313.6

gross_tax = 984,500 × 0.06 × 313.6 / 1000 = $18,524.83
lost_credit = 984,500 × 0.06 × 0.00090 = $53.16
net_tax = $18,524.83 − $53.16 = $18,471.67
```

### Per-tax-district millage lookup

For a polygon that spans multiple tax districts (Charleston city spans TDs 34, 35, 36, 52, 63, 71, 72, 99), apply the right millage per parcel:

```python
def millage_for(tax_dist):
    # All Charleston city districts use the same combined rate
    if tax_dist in ("3-4", "3-5", "3-6", "5-2", "6-3", "7-1", "7-2", "9-9"):
        return 313.6
    # Lexington: Town of Chapin vs unincorporated
    if tax_dist == "5C": return 551.582
    if tax_dist == "5":  return 461.743
    # Default fallback
    return 313.6
```

For unfamiliar districts, **stop and look up the actual rate on the county auditor's millage card**. Do not guess.

---

## 10. Derived Metrics

Every parcel gets these computed:

```python
def derive_metrics(rec, millage, ratio):
    appr = rec["appraisal"]
    land = rec["land_appr"]
    imp  = rec["imp_appr"]
    acres = rec["acres_cal"]

    rec["assessment_ratio"]  = ratio
    rec["value_per_acre"]    = appr / acres if acres > 0 else None
    rec["land_to_imp_ratio"] = land / imp if imp else None

    if rec["is_civic_exempt"]:
        gross_tax = 0.0
        net_tax = 0.0
    else:
        gross_tax = appr * ratio * (millage / 1000.0)
        # If county has LOST credit, subtract; else don't
        lost = appr * ratio * LOST_RATE  # 0.00090 for Charleston, 0 for Lexington
        net_tax = max(0.0, gross_tax - lost)

    rec["est_tax_gross"] = gross_tax
    rec["est_tax_net"]   = net_tax
    rec["tax_per_acre"]  = net_tax / acres if acres > 0 else None
```

### Aggregate metrics (per polygon)

```python
def summarize(records, polygon_acres):
    n = len(records)
    appr_total = sum(r["appraisal"] for r in records)
    tax_total  = sum(r["est_tax_net"] for r in records)
    land_total = sum(r["land_appr"] for r in records)
    civic = [r for r in records if r["is_civic_exempt"]]
    taxable = [r for r in records if not r["is_civic_exempt"]]
    return {
        "n": n,
        "polygon_acres": polygon_acres,
        "n_owner_occupied": sum(1 for r in records if r["legal_residence"]),
        "n_civic": len(civic),
        "appr": appr_total,
        "tax": tax_total,
        "vpa": appr_total / polygon_acres,                  # value per polygon acre
        "tpa": tax_total / polygon_acres,                   # tax per polygon acre
        "land_share_pct": land_total / appr_total * 100 if appr_total else 0,
        # And, if union was computed:
        "civic_land_acres": civic_land_acres,
        "taxable_land_acres": taxable_land_acres,
        "row_acres": polygon_acres - parcel_land_acres,
        "tpa_taxable": taxable_tax / taxable_land_acres,    # tax per taxable acre
    }
```

---

## 11. Output Files

### Naming

Use the geography's short name in snake_case:

- `walled_city_polygon.geojson`
- `walled_city_raw.geojson`
- `walled_city_data.geojson`
- `walled_city_slim.geojson`     (only if data.geojson > 20 MB)
- `walled_city_summary.json`
- `walled_city_parcels.csv`
- `walled_city_dashboard.html`   (if dashboard requested)

### `*_data.geojson` shape

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "Polygon", "coordinates": [[...]] },
      "properties": {
        "area_short": "Walled City",
        "pid": "4581301031",
        "address": "52 MEETING ST",
        "owner1": "PRUITT HELEN A TRUST",
        "tax_district": "7-1",
        "class_code": "101 - RESID-SFR",
        "use_group": "Residential",
        "legal_residence": false,
        "is_civic_exempt": false,
        "acres_cal": 0.0177,
        "land_appr": 654600,
        "imp_appr": 329900,
        "appraisal": 984500,
        "value_per_acre": 55564000,
        "tax_per_acre": 1043258,
        "est_tax_gross": 18524.83,
        "est_tax_net": 18471.67,
        "assessment_ratio": 0.06,
        "land_to_imp_ratio": 1.984,
        "centroid_lon": -79.9311,
        "centroid_lat": 32.7770
      }
    }
  ]
}
```

### `*_summary.json` shape

```json
{
  "areas": {
    "Walled City": {
      "name": "Charleston Walled City (1704 footprint)",
      "short": "Walled City",
      "color": "#6B1F00",
      "description": "...",
      "n": 831,
      "n_owner_occupied": 229,
      "n_civic": 84,
      "polygon_acres": 73.65,
      "parcel_land_acres": 53.95,
      "civic_land_acres": 10.65,
      "taxable_land_acres": 43.29,
      "row_acres": 19.70,
      "row_pct": 26.7,
      "appr": 1540000000,
      "land": 542000000,
      "imp":  998000000,
      "tax":  24570000,
      "vpa":  20910000,
      "tpa":  333530,
      "vpa_taxable": 35590000,
      "tpa_taxable": 550000,
      "land_pct": 35.2,
      "taxable_appr": 1500000000,
      "taxable_tax":  23800000
    }
  },
  "millage": 313.6,
  "ratio_oo": 0.04,
  "ratio_other": 0.06,
  "lost_rate": 0.00090
}
```

### Slim variant

When `*_data.geojson` exceeds 20 MB, produce a slim version for inline dashboard use:

- Drop sale_price, doc_date, deed info, mailing-address fields
- Round all floats to 3-4 decimal places
- Cast appraisal / land_appr / imp_appr to int
- Simplify geometry with `geom.simplify(0.00008, preserve_topology=True)` (tolerance is ~10m at SC latitudes)

Target: under 10 MB for inline use in a browser dashboard.

---

## 12. Dashboard Build (Optional)

### Brand language

The Carolina Redesign brand uses three fonts and a small palette:

```css
:root {
  --bg: #FAF7F2;             /* warm cream background */
  --bg-card: #FFFFFF;
  --ink: #1A1A1A;            /* primary text */
  --ink-soft: #404040;
  --ink-mute: #7A7A7A;
  --line: #E5DFD3;           /* subtle border */
  --line-strong: #C9C0AC;
  --accent: #6B1F00;         /* terra cotta — primary accent */
  --accent-soft: #B8694D;
  /* For multi-area analyses, additional palette: */
  --ce: #5D6B4F;             /* mossy green — secondary */
  --wa: #445B7A;             /* slate blue — tertiary */
  /* Heat map (5-step from cream to deep brick): */
  --hot-1: #FFF5E1;
  --hot-2: #FFD78A;
  --hot-3: #F59E45;
  --hot-4: #D4501F;
  --hot-5: #6B1F00;
}
```

Fonts (load from Google Fonts):

```html
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700;900&family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600;8..60,700&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
```

- **Playfair Display** for headlines and big numbers (editorial serif with character)
- **Source Serif 4** for long-form body text (if writing a report-style page)
- **Inter** for UI labels, kickers, tables (clean neutral sans)

### Map rendering

Use Leaflet with the CartoCDN basemap:

```html
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
```

```js
const map = L.map('map', {
  zoomControl: true,
  preferCanvas: true,    // CRITICAL for 1000+ polygons
  scrollWheelZoom: true,
  attributionControl: false
}).setView([32.78, -79.93], 16);

L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
  maxZoom: 19, subdomains: 'abcd'
}).addTo(map);
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png', {
  maxZoom: 19, subdomains: 'abcd', pane: 'shadowPane'
}).addTo(map);
```

The basemap pair (no-labels + labels-only on the shadow pane) is the editorial trick — your parcel polygons render BELOW the labels, so labels stay readable even when overlaid on a dense parcel choropleth.

### Data-driven parcel styling

```js
const hotPalette = ['#FFF5E1','#FFD78A','#F59E45','#D4501F','#6B1F00'];

function quantileColor(value, sortedAll) {
  if (value == null || isNaN(value)) return '#DCDCDC';
  // Find this value's position in the sorted distribution
  let lo = 0, hi = sortedAll.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedAll[mid] < value) lo = mid + 1; else hi = mid;
  }
  const pct = lo / sortedAll.length;
  return hotPalette[Math.min(4, Math.floor(pct * 5))];
}

const parcelLayer = L.geoJSON(PARCELS, {
  style: f => ({
    color: '#2A2A2A',
    weight: 0.3,
    fillColor: quantileColor(f.properties.tax_per_acre, sortedTpa),
    fillOpacity: 0.78,
  }),
  onEachFeature: (f, layer) => {
    layer.bindPopup(parcelPopupHTML(f.properties));
  }
});
```

### Charts via ECharts

```html
<script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>
```

For the use-mix chart, use a **horizontal bar chart**, not a donut. Donut labels collide on narrow screens. Horizontal bars handle long category names cleanly:

```js
echarts.init(document.getElementById('chartUse')).setOption({
  grid: { left: 140, right: 60, top: 12, bottom: 24 },
  xAxis: { type: 'value', axisLabel: { formatter: '{value}%' } },
  yAxis: { type: 'category', data: useBars.map(b => b.group), axisTick: { show: false } },
  series: [{
    type: 'bar',
    data: useBars.map(b => b.pct),
    itemStyle: { color: '#6B1F00' },
    label: { show: true, position: 'right', color: '#6B1F00', formatter: '{c}%' }
  }]
});
```

### Standard page structure

A minimal dashboard has:

1. **Header / hero** — kicker, title, subtitle, byline
2. **Stats ribbon** — 6 key numbers in a horizontal grid (parcels, acres, appraised, annual tax, $/ac value, $/ac tax)
3. **Map** (left, ~60% width) — color-coded parcels with metric toggle, legend
4. **Filter / detail panel** (right, ~40% width) — top performers table, civic landholders table
5. **Charts row** — use mix + tax-per-acre histogram
6. **Context / methodology** — narrative paragraph, source citations
7. **Footer** — attribution

For multi-area analyses, add a comparison "reveal" section between the stats ribbon and the map: side-by-side bar chart showing the per-acre productivity ratio across areas. That's the chart that lands the argument.

---

## 13. Common Pitfalls and Fixes

| Symptom | Cause | Fix |
|---|---|---|
| `404 File or directory not found` on parcel query | URL too long (encoded polygon pushes GET past server limits) | Use POST with `data=` instead of `params=` |
| `406 Not Acceptable` from Overpass API | Missing `User-Agent` header | Add `headers={"User-Agent": "AppName/1.0 (email)"}` |
| `TopologyException: side location conflict` from unary_union | Invalid parcel polygons (self-intersections, duplicate vertices) | Run each through `make_valid` + `buffer(0)` rescue before union |
| Citywide query takes 30+ minutes on centroid-in-multipolygon | Naive contains check is O(N) | Use `shapely.prepared.prep(geom)` for indexed contains |
| 500 from county REST | Service exists in docs but isn't started (we hit this with Newberry) | Verify with curl + JSON metadata; if truly down, document gap and skip |
| Parcel acreage sum vastly exceeds polygon area | Condo parcels each carry the full building footprint as their geometry | Either accept the overcount (use polygon area as denominator) or unary_union to get true land |
| Tract union polygon is 5× expected size | Census tracts can extend far beyond a small buffer | After querying tracts, filter to centroid-within-radius before unioning |
| Lots of "Other" use group classifications | County uses different code prefixes than expected | Probe specific code values, check owner names for civic clues, build county-specific use_group function |
| Zero owner-occupied parcels in a town | `legal_residence` field value isn't what was expected (e.g., Lexington uses "LR YES" not "Y") | Inspect raw values, update the adapter |
| Dashboard HTML over 25 MB | Too much data inline | Slim properties, simplify geometries, or split into overview + drill-down pages |

---

## 14. Quality Checks

Before declaring a run successful, verify:

1. **Parcel count is sensible.** Cross-check against the county auditor's published count or the census of population.
2. **Total appraised is plausible.** Look up a few well-known parcels by hand and confirm the values match.
3. **Polygon area matches the published municipal area.** If your computed area differs by more than ±20% from the official figure, the polygon is probably wrong.
4. **Civic share is in a believable range.** Most urban areas are 3-15% civic; if you're getting 0% or 50%, the classifier is broken.
5. **Top tax-per-acre parcels are visually inspectable.** Pull up 3 of them in the county assessor's online viewer and confirm they're real.
6. **Sample randomly.** Grab 5 random parcels, print full records, sanity-check addresses + owners + values.
7. **Tax total is in the right range.** A rough order-of-magnitude check: combined millage / 1000 × total appraised × 0.05 (rough average ratio) ≈ expected tax. If you're 5× off, something's wrong.

---

## 15. Known Limitations

What this pipeline does NOT do:

- **Condo unit counts.** Each condo unit is treated as a separate parcel, but unit counts per building aren't aggregated. Total dwelling unit counts will be approximate.
- **Historic-preservation easement adjustments.** Some parcels in historic districts have appraisal reductions or tax credits that aren't reflected in the basic SC formula. Tax estimates are upper bounds for affected parcels.
- **Conservation easements.** Same as above.
- **Owner-occupied special programs.** SC has homestead, disabled-veteran, and other exemptions beyond the 4% ratio. The pipeline applies only the basic ratio.
- **Newberry County and similar private-data counties.** Where a county does not expose a public parcel REST endpoint, the pipeline cannot acquire data. Document the gap honestly and either narrow scope or use a paid third-party aggregator.
- **Non-SC tax formulas.** Outside SC, the assessment-ratio approach varies. The pipeline must be told the right formula for the state.
- **Inflation / year-over-year change.** All values are as-of the snapshot date. The pipeline does not produce time-series.
- **Sales history beyond most-recent.** The county REST exposes only one sale-price + date per parcel. Full sales history requires a separate deeds-office query.

---

## 16. Worked Example: The Charleston Walled City

This is the canonical reference case for the whole pipeline.

### Inputs

- Geography: Charleston Walled City (1704 enceinte)
- State: SC
- County: Charleston
- Polygon: hand-drawn rectangle from parcel-address centroids of parcels named on Meeting, Cumberland, East Bay, Water Streets

### Boundary

```python
walled_city_coords = [
    [-79.9311, 32.7731],   # SW = Meeting & Water
    [-79.9271, 32.7731],   # SE = East Bay & Water
    [-79.9264, 32.7800],   # NE = East Bay & Cumberland (East Bay curves east at top)
    [-79.9311, 32.7794],   # NW = Meeting & Cumberland
    [-79.9311, 32.7731],   # close ring
]
# Polygon area: 73.65 acres
```

### County GIS

```python
rest_url = "https://gisccapps.charlestoncounty.org/arcgis/rest/services/CDC/CDC_ParcelMap/MapServer/0/query"
field_adapter = CHARLESTON_FIELD_MAP  # see section 5
```

### Tax math

```python
MILLAGE = 313.6        # Charleston City peninsula (TD 71) combined
RATIO_OO = 0.04        # owner-occupied
RATIO_OTHER = 0.06     # everything else
LOST_RATE = 0.00090
```

### Pipeline run

```python
# 1. Query parcels
raw_feats = query_parcels(rest_url, walled_city_coords)
# Returns ~830 features (some just outside polygon, filtered next)

# 2. Centroid-in-polygon filter
prep_poly = prep(polygon)
inside = [f for f in raw_feats if prep_poly.contains(shape(f["geometry"]).centroid)]
# 831 parcels inside

# 3. For each, apply field adapter, classify, compute tax
cleaned = []
for feat in inside:
    p = feat["properties"]
    rec = build_canonical_record(p, field_adapter)
    rec["use_group"] = use_group_charleston(rec["class_code"])
    rec["is_civic_exempt"] = is_civic_exempt(rec["class_code"], rec["appraisal"])
    apply_tax_math(rec, MILLAGE, LOST_RATE)
    cleaned.append(rec)

# 4. Land breakdown (small enough to do unary_union safely)
all_geoms = [shape(f["geometry"]).intersection(polygon) for f in inside]
civic_geoms = [g for g, r in zip(all_geoms, cleaned) if r["is_civic_exempt"]]
parcel_union = safe_union(all_geoms)
civic_union = safe_union(civic_geoms)
# parcel_land = 53.95 ac, civic_land = 10.65 ac, ROW = 19.70 ac

# 5. Aggregate summary
summary = summarize(cleaned, polygon_acres=73.65)
# Result: $1.54B appraised, $24.57M annual tax, $333K/polygon acre,
#         $550K/taxable acre, 27.6% owner-occupied, 36% land share

# 6. Save outputs
save_geojson("walled_city_polygon.geojson", polygon_feature)
save_geojson("walled_city_data.geojson", {"type": "FeatureCollection", "features": [...]})
save_json("walled_city_summary.json", summary)
save_csv("walled_city_parcels.csv", cleaned)
```

### Expected output magnitudes

- Raw query: ~830 features (≈1 MB GeoJSON)
- Inside polygon: 831 features
- `_data.geojson`: ~1 MB
- `_summary.json`: ~2 KB
- `_parcels.csv`: ~200 KB
- `_dashboard.html` (if built): ~1 MB

### Headline result

| Metric | Value |
|---|---|
| Polygon area | 73.65 ac |
| Parcels | 831 |
| Total appraised | $1.54B |
| Annual tax | $24.57M |
| Tax / polygon acre | **$334K** |
| Tax / taxable acre (ex-civic) | $550K |
| Land share of value | 35.2% (healthy) |
| Owner-occupied % | 27.6% |
| Civic land share | 14.5% (high — five churches, museums, Old Exchange, Powder Magazine, City Hall) |

For context: comparable suburban Charleston (Savannah Hwy strip in West Ashley) generates ~$18K per polygon acre. The walled city out-earns the suburban strip by **19× per polygon acre** under identical tax structure.

---

## 17. Scaling Beyond a Single Polygon

The same pipeline scaled five times in this thread without structural change. Each step taught us something:

### Step 1 → 2: Multi-area comparison (Walled City + CENA + West Ashley)

Add a loop. Each area has its own polygon, runs through the same pipeline, produces its own summary. The unified output combines them with `area_short` as the discriminator. The comparison story emerges from putting the three summaries next to each other.

**What changes:** the `summary.json` becomes a dict of areas. The dashboard adds an area toggle. Maps fit to the union of all polygons.

### Step 2 → 3: New county (Lexington for Chapin proper)

Different county = different REST endpoint, different field schema, different millage. Build a Lexington adapter (section 5). Verify everything works against the new schema by sampling 5 parcels and inspecting. Don't trust the prior county's field-value patterns ("LR YES" vs "Y" is the example).

**What changes:** a new field adapter, a new use-group classifier (4-digit Lexington codes vs 3-digit Charleston codes), a new millage value. The rest of the pipeline is unchanged.

### Step 3 → 4: Multi-tract polygon (Greater Chapin)

The polygon now comes from a union of Census tracts rather than a hand-drawn rectangle. The tract union can be much larger than expected if a single tract extends rurally. Filter tracts by centroid-within-radius before unioning.

**What changes:** boundary construction now uses Census TIGER; parcel queries return many more features (10K+); pagination matters more. Methodology gaps appear (Newberry County didn't expose REST publicly, so Greater Chapin was scoped to Lexington only and the gap was documented).

### Step 4 → 5: Citywide multipolygon (Charleston citywide)

Census-defined city polygons are MultiPolygons with many disjoint parts (Charleston city = 71 parts spanning peninsula, West Ashley, James Island, Daniel Island, Cainhoy). Query volume jumps to 30,000+ parcels. The unary_union step becomes prohibitively slow.

**What changes:**
- Use bbox query instead of POSTing the multipolygon (the URL would be enormous)
- Use `shapely.prepared.prep` for fast centroid-in-multipolygon
- Skip the per-parcel intersection clip
- Skip the parcel union; use polygon area as the per-acre denominator
- Stream / paginate output writing; don't hold everything in memory

### What's universal across all five runs

- The canonical schema in section 5 — unchanged across counties, states could vary
- The classification logic in section 8 — unchanged in concept, county-specific adapters underneath
- The tax math in section 9 — SC-specific; would change for other states
- The output file shapes in section 11 — unchanged
- The dashboard brand language in section 12 — unchanged across all four dashboards built in this thread

### Sizing rules of thumb

| Scale | Parcels | Acres | Approach |
|---|---|---|---|
| Neighborhood / district | < 1,000 | < 200 | Full pipeline with union, validation, intersection clip |
| Small town | 1,000 – 5,000 | < 5,000 | Full pipeline; consider slimming dashboard data |
| Town + fringe | 5,000 – 15,000 | < 50,000 | Use prepared geometry for filter; union still feasible |
| Citywide | 15,000 – 50,000 | < 200,000 | Skip union; use polygon area as denominator |
| Metro | 50,000+ | 500,000+ | Multiple county queries; aggregate by sub-area; skip union; serve as tileset, not inline GeoJSON |

---

## 18. Appendix — Reference Constants

### Tested county REST endpoints (SC)

```
Charleston County:
  https://gisccapps.charlestoncounty.org/arcgis/rest/services/CDC/CDC_ParcelMap/MapServer/0
  Field schema: CHARLESTON_FIELD_MAP (section 5)
  Use-group classifier: use_group_charleston() (section 8)
  Combined millage (city of Charleston): 313.6
  LOST credit rate: 0.00090

Lexington County:
  https://maps.lex-co.com/agstserver/rest/services/Property/MapServer/4
  Field schema: LEXINGTON_FIELD_MAP (section 5)
  Use-group classifier: use_group_lexington() (section 8)
  Combined millage (Town of Chapin): 551.582 (TD 5C)
  Combined millage (unincorporated D5): 461.743 (TD 5)
  LOST credit rate: 0

Newberry County:
  Public parcel REST not currently available (as of May 2026).
  Auditor: https://www.newberrycounty.gov/auditor/department-information/tax-levy-information
  If needed: contact GIS office directly or use Regrid/ATTOM.

Berkeley County: not yet tested
Dorchester County: not yet tested
```

### SC FIPS codes

```
SC state FIPS: 45
County FIPS:
  Berkeley:    015
  Charleston:  019
  Dorchester:  035
  Lexington:   063
  Newberry:    071
  Richland:    079
```

### Census TIGER REST endpoints

```
Incorporated Places (current vintage):
  https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/4

Census Tracts (current vintage):
  https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/0

County boundaries:
  https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer

Boundaries.us (alt for place CSVs):
  https://boundaries.us/borders/place/{geoid}.csv
```

### SC assessment ratios (SC Code Ann. § 12-43-220)

```
Owner-occupied legal residence:     4%
Other residential / commercial:     6%
Manufacturing / utility:            10.5%
Agricultural (private):             4%
Agricultural (corporate):           6%
```

### Tested geographies in this pipeline

| Geography | Parcels | Acres | Annual tax | $/ac tax |
|---|---|---|---|---|
| Charleston Walled City | 831 | 73.65 | $24.57M | $334K |
| Cannonborough-Elliotborough (CENA) | 927 | 194.10 | $25.18M | $129K |
| Savannah Hwy suburban corridor | 177 | 69.51 | $1.26M | $18K |
| Town of Chapin | 795 | 1,296.34 | $7.05M | $5.4K |
| Greater Chapin (Lexington portion) | 11,539 | 56,879.30 | $103.50M | $1.8K |
| Charleston citywide (Charleston Co. portion) | 30,447 | 88,120 | $384M | $4.4K |

---

## End of spec

If Claude Code follows this document and produces all six output files for a new geography that the user can verify against the county assessor's published numbers, the run is complete. Hand the outputs back to the human who supplied the geography and let them do the editorial / narrative work in their own thread.

Maintained by Jimmy Ardis · Carolina Redesign · May 2026.
