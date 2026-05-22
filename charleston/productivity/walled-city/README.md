# Walled City Core — Charleston (3-area study)

The original property productivity study covering three sub-areas of Charleston:
the 1704 Walled City, Cannonborough-Elliotborough (CENA), and the Savannah Highway
suburban strip in West Ashley. Methodology in `walled_city_pipeline_spec.md`.

```
walled-city-core/
├── README.md
├── walled_city_pipeline_spec.md        # full methodology spec
├── three_area_unified/                 # combined dataset
│   ├── polygons.geojson
│   ├── data.geojson
│   ├── summary.json
│   ├── parcels.csv
│   └── intersections.json
├── walled_city/                        # 1704 enceinte
│   ├── polygon.geojson
│   ├── raw.geojson                     # untouched ArcGIS REST response
│   ├── data.geojson                    # enriched parcels (the canonical output)
│   ├── data_clean.json                 # JSON variant
│   ├── parcels.csv
│   └── summary.json
├── cena/                               # Cannonborough-Elliotborough
│   ├── data.geojson
│   └── summary.json
└── west_ashley/                        # Savannah Hwy strip
    ├── polygon.geojson
    ├── raw.geojson
    ├── data.geojson
    └── summary.json
```

## Headline numbers

| Area | Parcels | Acres | Annual tax | $/ac tax |
|---|---|---|---|---|
| Walled City | 831 | 73.65 | $24.57M | $334K |
| CENA | 927 | 194.10 | $25.18M | $129K |
| West Ashley | 177 | 69.51 | $1.26M | $18K |

All at City of Charleston combined millage 313.6, SC 4%/6% ratios, 0.00090 LOST credit.
