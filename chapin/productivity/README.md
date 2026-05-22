# Chapin, SC — Property Productivity Data

Property productivity data for the Town of Chapin proper (Lexington County,
2 sq mi incorporated) and Greater Chapin (the 6-tract Census-defined area
spanning Lexington and Newberry counties, ~89 sq mi).

```
chapin-data/
├── README.md
├── proper/                                # Town of Chapin (incorporated)
│   ├── polygon.geojson
│   ├── raw.geojson                        # untouched Lexington County REST response
│   ├── data.geojson                       # enriched parcels
│   ├── parcels.csv
│   ├── summary.json
│   ├── intersections.json                 # OSM intersection count for vincity
│   └── boundary_raw.csv                   # Census TIGER place 4513150 vertices
└── greater/                               # Greater Chapin (6 census tracts)
    ├── polygon.geojson                    # tract union (Lexington portion only)
    ├── tracts.geojson                     # raw Census TIGER tracts
    ├── data.geojson                       # 11,539 parcels
    ├── data_slim.geojson                  # simplified for inline use
    ├── parcels.csv
    ├── lexington_raw.geojson              # untouched Lexington REST response
    └── summary.json
```

## Headline numbers

| Area | Parcels | Acres | Annual tax | $/ac tax |
|---|---|---|---|---|
| Town of Chapin | 795 | 1,296 | $7.05M | $5K (top of downtown: $321K/ac) |
| Greater Chapin (Lex only) | 11,539 | 56,879 | $103.5M | $1.8K |

- Tax District 5C (Town of Chapin) millage: **551.582**
- Tax District 5 (Lexington unincorporated): **461.743**
- SC 4%/6% assessment ratios applied per parcel
- Lexington County has no LOST credit equivalent

## The Newberry gap

Greater Chapin spans Lexington (FIPS 45063) and Newberry (FIPS 45071) counties.
Newberry County does not currently expose a public parcel REST endpoint, so
the Newberry-side tracts (Census 9506.03 and 9506.04, ~77 sq mi) are not
included. The numbers above reflect Lexington portion only.

## Lexington County field schema

| Canonical | Lexington field name |
|---|---|
| `pid` | `TMS` |
| `owner1` | `Owner` |
| `address` | `PropAddr_Num` + `PropAddr_Str` + `PropAddr_Suf` |
| `legal_residence` | `LR` (value is "LR YES" or "LR NO") |
| `appraisal` | `MktTotal` |
| `land_appr` | `TaxableLand` |
| `imp_appr` | `TaxableBldg` |
| `acres_cal` | `Acres` |
| `class_code` | `PropTypeCode` (4-digit codes; 9xxx series = civic/exempt) |
| `tax_district` | `TaxDist` |
| `sale_price` | `SalePrice` |
