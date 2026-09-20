# ATLAS.md

> This file is maintained by Claude Code and read by Atlas (your AI Chief of Staff).
> You don't need to edit it manually — Claude Code updates it at the end of each work session.

## Meta

| Field | Value |
|-------|-------|
| **Project** | TownRing |
| **One-liner** | Voice-driven census data web maps for SC cities with Vapi voice agents and choropleth visualization |
| **Status** | building |
| **Last Active** | 2026-09-20 |
| **Stall Threshold** | 7 days |
| **Repo** | https://github.com/jimmyardis/townring |
| **Stack** | Mapbox GL JS, Vapi (voice SDK + phone), Express/Node (Railway API), GitHub Pages, Python (Census data pipeline) |

## Current State

4 cities live at townring.com, each with 15 choropleth metrics on ACS 2024, cinematic mode, year slider, voice tools and its own colour theme: Chapin (24 tracts, 20 km around Chapin), Columbia (190 tracts, Richland + Lexington), Charleston (178 tracts, tri-county), Sumter (26 tracts, Sumter County). Phone layout is now owned by `shared/mobile.css` + `shared/mobile.js` for every city rather than four drifting media queries. The Railway voice API serves all four cities and matches what the maps show.

## Next Action

Point the Vapi assistants at `gpt-realtime-2025-08-28` (native speech-to-speech, existing tool configs port unchanged) and re-pick each city's voice, since ash/ballad/coral/fable/onyx/nova are unavailable on realtime models.

## Blockers

- **TIGERweb is WAF-blocking this network.** Every request to `tigerweb.geo.census.gov` returns a 189-byte "Request Rejected" page, root included, from any User-Agent. `api.census.gov` (ACS/decennial) is fine, so only tract *geometry* is unreachable and `execution/fetch_census.py` cannot complete a new city build. `execution/scope_city.py` works around it for cities carved out of an existing build. Retry before the next from-scratch city.

## Open Questions

- Next SC city after Sumter? (Greenville is the largest untapped metro; Spartanburg and Florence also candidates) — blocked on TIGERweb above.
- Meta-agent: what's the minimal prompt interface to trigger a new city build autonomously?
- Mapbox token GitHub-secret-scanner issue — resolve the commit workflow for new cities.
- Charleston carries a **different Mapbox token** from the other three, and it appears URL-restricted to townring.com — the map renders blank on localhost. Worth unifying on the unrestricted token used by the other three.
- `execution/cities/sumter.json` sets `scdot_layer: 42`, which is Spartanburg; Sumter is 43. Only matters when a productivity run is done for Sumter.
- Should Chapin's homepage card still read "both counties"? At 20 km it is mostly Lexington with a slice of Richland.

## Session Log

<!-- Append-only. Most recent session on top. Claude Code adds an entry at the end of each work session. -->

### 2026-09-20

**Mobile layout pass (all 4 cities).** The reported bug reproduced at 390x844: the legend, year slider and voice button were each pinned to the bottom independently, so all three landed in the same ~130px band and the slider painted *over* the legend — the colour key was invisible, not merely cramped. The 8 control buttons took a 225px column over the map. Charleston had never received the earlier mobile pass at all (its media query was 10 lines vs ~130): header ate 43% of the screen, legend overlapped the layer picker and buttons with labels cut mid-word, and it still told touch users to "right-click + drag to rotate".
- Added `shared/mobile.css` + `shared/mobile.js`, loaded by all four cities, so phone layout lives in one place instead of four divergent media queries. Cities keep only a `--tr-accent` variable.
- `mobile.js` moves legend / slider / voice button into a single `.tr-dock` flex column so they stack; folds the controls behind a ☰ toggle; adopts Charleston's free-floating `.metric-selector` into that same panel; makes the legend collapsible by tapping its title. All of it reverses on crossing the breakpoint, so rotating a phone does not strand the UI.
- Verified zero overlap on all four cities on the live site, and confirmed desktop is unchanged plus a resize round-trip restores every node.
- Decision: kept the Mapbox logo and attribution visible in a 26px strip at the dock's foot (their terms require it) and hid only the zoom/compass buttons, which pinch and two-finger rotate already cover.

**Chapin was the Columbia map.** `chapin-places.geojson` and `columbia-places.geojson` were byte-identical and the tract sets matched exactly — "The Chapin Map" reported 709,693 people for a town of ~1,500. Cause: both configs list Lexington + Richland and `fetch_census.py` pulls whole counties; `--radius` only *tagged* tracts with `is_greater_area`, a property nothing ever read.
- `--radius` now filters, and `radius_km` in a config makes a city radius-scoped. Chapin set to 20 km, chosen so Irmo (18.9 km) is in while Lexington town (23.2 km) and Columbia (43.7 km) are out. 190 tracts → 24, population 95,832.
- Added `execution/scope_city.py` to derive a scoped city from an already-built one offline, since TIGERweb is blocked (see Blockers). Also updated `GREATER_CHAPIN_BOUNDS` and the homepage card, which still claimed "9 tracts" and "~43,000".

**Growth statistics were inflated everywhere.** Aggregate growth summed every tract's 2020 population against only the tracts that existed in 2010, inventing growth wherever boundaries changed. Columbia advertised **52.0%** where like-for-like is **4.7%**; Charleston 54.1% → 16.6%; Sumter 25.9% → **-3.3%**, i.e. Sumter is shrinking, not growing. Fixed in both `fetch_census.py` and `scope_city.py`, repaired the three existing summaries, and recorded the basis in a new `growth_basis` field.

**Voice backend had drifted from the maps.** The Railway API (`chapin-talkmap-api`) answered for only 3 cities:
- Sumter was never added — its map and Vapi assistant were live but every tool call returned "couldn't find a place". Registered it.
- Columbia was still the pre-expansion 98-tract Richland-only build, so `get_county_data("Lexington")` returned "No county data". Re-synced to 190 tracts.
- All cities sat on ACS 2020/2022 while the maps had moved to ACS 2024, so agent and map disagreed about population.
- Fixed a latent bug: chapin's `area_flag` tested `is_greater_chapin`, a property that does not exist (it is `is_greater_area`), so it never matched.
- Pushed; Railway auto-deployed from GitHub and all four cities verified live.

**Also fixed:** Charleston's year slider was capped at 2022 while its data runs to 2024, and its `set_year` voice tool rejected 2023–24.

**Researched OpenAI's realtime voice models.** `gpt-realtime-2` (OpenAI, May 2026) is *not yet* selectable in Vapi — their docs still list `gpt-realtime-2025-08-28` as the production realtime model. That previous-gen model is worth moving to: native speech-to-speech replaces the transcribe→LLM→TTS relay where the latency lives, and existing tool configs port unchanged, which matters because TownRing is almost entirely tool-driven. Costs: no knowledge bases (unused here), no voice cloning, and 6 OpenAI voices unavailable, so each city needs a new voice picked. Deliberately sequenced *after* the backend sync — a faster agent reading stale data just gets to the wrong answer sooner.

### 2026-05-28

- Expanded Columbia from 98 → 190 tracts (added Lexington County FIPS 063 alongside Richland FIPS 079); bounding box updated, voice fly targets for Lexington added
- Built Sumter, SC as 4th city end-to-end: `execution/cities/sumter.json`, ACS 2023 pipeline (26 tracts, pop 106,675), `sumter/index.html`, `map.js`, `styles.css`, `voice.js`
- Sumter landmarks: Downtown, Shaw AFB, Swan Lake Iris Gardens, Manchester State Forest
- Sumter voice fly targets: shaw/shaw afb, swan lake, manchester, mayesville, pinewood
- Olive/earth color theme (#5C4A1E) — distinct from navy (Chapin/Charleston) and brown (Columbia)
- Root `index.html`: 4th city dot added to SC SVG, card grid updated, Columbia card corrected to 190 tracts
- All 3 commits pushed to jimmyardis/townring main

### 2026-05-23

- Created ATLAS.md for project tracking
- No code changes this session — file placement only
