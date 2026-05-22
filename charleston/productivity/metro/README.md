# Charleston Tri-County Metro — Case Studies

Per-area property productivity data for nine named places across the Charleston
metro (Charleston, Berkeley counties). Built from the era-of-development
narrative spanning 1704 (Walled City) to present (Mt. Pleasant suburbs).

## Areas

| Folder | Era | Parcels | Acres | $/ac tax |
|---|---|---|---|---|
| `mt_pleasant/` | 1900s-present (mixed) | 40,143 | 37,583 | $12K |
| `north_charleston/` | 1972+ annexation era | 30,277 | 52,343 | $5K |
| `daniel_island/` | 1996+ planned community | 4,682 | 6,431 | $17K |
| `folly_beach/` | small beach town | 2,944 | 12,083 | $3K |
| `ion/` | 1995 TND (Vince Graham) | 258 | 146 | $15K |
| `park_west/` | 1990s-2000s subdivision | 232 | 290 | $6K |

(Walled City, CENA, West Ashley are in `walled-city-core.zip`.)

## Layout

```
charleston-metro/
├── README.md
├── muni_polygons.geojson            # all muni boundaries in one FeatureCollection
├── summary.json                     # all-area summary stats
├── mt_pleasant/
│   ├── data_slim.geojson            # simplified geometries (manageable size)
│   └── summary.json
├── daniel_island/
│   ├── data.geojson                 # full attribute set (Berkeley Co schema)
│   └── summary.json
├── north_charleston/
│   ├── data_slim.geojson
│   └── summary.json
├── folly_beach/
│   ├── data_slim.geojson
│   └── summary.json
├── ion/
│   ├── data.geojson                 # full — small
│   └── summary.json
└── park_west/
    ├── data.geojson                 # full — small
    └── summary.json
```

## Caveats

- I'On and Park West polygons are derived from the parent Mt. Pleasant parcel set
  by subdivision-name filter. Not census-complete.
- Daniel Island parcel data comes from Berkeley County GIS, which lacks the
  land/improvement value split and the owner-occupied flag. Tax math uses
  a flat 6% commercial ratio for Berkeley parcels.
- Dorchester County is NOT in this bundle (Summerville etc.) because the
  Dorchester REST does not expose appraised values.
