# TownRing

> A phone number for every place. Voice-driven maps that explain themselves.

Live at **[townring.com](https://townring.com)**.

## Cities

| City | URL | Status |
|---|---|---|
| Chapin, SC | [/chapin](https://townring.com/chapin) | ✅ Live |
| Charleston, SC | [/charleston](https://townring.com/charleston) | 🚧 In build |
| Columbia, SC | — | ⏳ Planned |

## Architecture

Each city lives in its own subfolder. The frontend is static HTML/CSS/JS deployed via GitHub Pages. The voice agent is powered by [Vapi](https://vapi.ai); the data tools API runs on Railway.

```
townring/
├── index.html       # Homepage (this site)
├── CNAME            # Custom domain config
├── chapin/          # Greater Chapin map
│   ├── index.html
│   ├── styles.css
│   ├── map.js
│   ├── voice.js
│   └── data/        # Census + ACS + place GeoJSON
└── charleston/      # Greater Charleston (coming soon)
```

## Tech stack

- **Map**: Mapbox GL JS v3 (Standard style, globe projection in cinematic mode)
- **Voice**: Vapi (Web SDK + Twilio for inbound calls)
- **Data**: US Census Bureau (Decennial 2010/2020 + ACS 5-year), TIGER/Line, plus per-city sources
- **API**: Railway-hosted Express server with tools the voice agent calls
- **Hosting**: GitHub Pages (frontend), Railway (API)

## Deploy

Push to `main` — GitHub Pages auto-deploys in ~30 seconds.
