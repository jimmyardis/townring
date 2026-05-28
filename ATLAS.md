# ATLAS.md

> This file is maintained by Claude Code and read by Atlas (your AI Chief of Staff).
> You don't need to edit it manually — Claude Code updates it at the end of each work session.

## Meta

| Field | Value |
|-------|-------|
| **Project** | TownRing |
| **One-liner** | Voice-driven census data web maps for SC cities with Vapi voice agents and choropleth visualization |
| **Status** | building |
| **Last Active** | 2026-05-28 |
| **Stall Threshold** | 7 days |
| **Repo** | https://github.com/jimmyardis/townring |
| **Stack** | Mapbox GL JS, Vapi (voice SDK + phone), Express/Node (Railway API), GitHub Pages, Python (Census data pipeline) |

## Current State

4 cities fully built and live: Chapin (190 tracts, Lexington + Richland), Columbia (190 tracts, Richland + Lexington expanded from 98), Charleston (178 tracts, tri-county), Sumter (26 tracts, Sumter County). All cities have 15 choropleth metrics (ACS 2023 refresh), cinematic mode, time slider, voice tools, and distinct color themes. New city spin-up time is now ~2 hours end-to-end following the established pattern.

## Next Action

Wire a Vapi assistant for Sumter (`voice.js` has placeholder keys) — create the assistant in the Vapi dashboard, paste the public key + assistant ID, and test the voice integration.

## Blockers

- None

## Open Questions

- Next SC city after Sumter? (Greenville, Spartanburg, Florence are strong candidates — Greenville is the largest untapped metro)
- Meta-agent: what's the minimal prompt interface to trigger a new city build autonomously?
- Mapbox token GitHub-secret-scanner issue — resolve the commit workflow for new cities

## Session Log

<!-- Append-only. Most recent session on top. Claude Code adds an entry at the end of each work session. -->

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
