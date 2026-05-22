# Charleston Citywide — Property Productivity Data

City of Charleston (Census TIGER place 4513330) — incorporated city boundary as
a MultiPolygon spanning peninsula, West Ashley, James Island annexes, Daniel
Island, Cainhoy. This data covers the **Charleston County portion** of the
City of Charleston (30,447 parcels). For Daniel Island and Cainhoy (in Berkeley
County), see `charleston-metro.zip → metro/daniel_island/`.

```
charleston-citywide/
├── README.md
├── polygon.geojson                  # the city's MultiPolygon boundary
├── data_slim.geojson                # parcels with simplified geometry (20 MB)
├── summary.json                     # aggregate stats
└── parcels.csv                      # tabular variant
```

## Headline

- 30,447 parcels in 88,120 acres (137.7 sq mi)
- $26.07 billion in total appraised value
- $384 million in estimated annual property tax
- $4,360 per polygon acre — but the walled city sub-area pays $334K/acre

## Not included due to file-size limit

- `raw.geojson` — the untouched 337 MB ArcGIS REST response. Can be regenerated
  via the pipeline spec.
- `data.geojson` — the 86 MB full-geometry version. Same — regenerate or use the
  slim version included here.

## Methodology

See `walled-city-core.zip → walled_city_pipeline_spec.md` for the full pipeline
documentation. This run used the Charleston County `CDC_ParcelMap/MapServer/0`
endpoint with bbox + centroid-in-multipolygon filter.
