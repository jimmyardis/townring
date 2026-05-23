# ATLAS.md

> This file is maintained by Claude Code and read by Atlas (your AI Chief of Staff).
> You don't need to edit it manually — Claude Code updates it at the end of each work session.

## Meta

| Field | Value |
|-------|-------|
| **Project** | TownRing |
| **One-liner** | Voice-driven census data web maps for SC cities with Vapi voice agents and choropleth visualization |
| **Status** | building |
| **Last Active** | 2026-05-23 |
| **Stall Threshold** | 7 days |
| **Repo** | https://github.com/jimmyardis/townring |
| **Stack** | Mapbox GL JS, Vapi (voice SDK + phone), Express/Node (Railway API), GitHub Pages, Python (Census data pipeline) |

## Current State

Chapin, SC is the canonical reference implementation — fully built with ~190 census tracts, 9 voice tools, 6 visual metrics, and cinematic clip mode. Columbia city page was added 2026-05-22. A comprehensive layer methodology spec (`TownRing Layer Methodology — Design Spec`) documents all patterns (Census fetch, boundary layers, voice tools, new city spin-up). The long-term vision is a meta-agent that can spin up any SC city in ~2 hours.

## Next Action

Complete the Columbia city data pipeline: run the universal Census/ACS data fetcher for Richland + Lexington counties and generate `columbia-area-tracts.geojson` with all standard tract properties.

## Blockers

- None

## Open Questions

- Which SC city after Columbia? (Charleston, Greenville, Spartanburg are the obvious next candidates)
- Meta-agent: what's the minimal prompt interface to trigger a new city build autonomously?
- Mapbox token GitHub-secret-scanner issue — resolve the commit workflow for new cities

## Session Log

<!-- Append-only. Most recent session on top. Claude Code adds an entry at the end of each work session. -->

### 2026-05-23

- Created ATLAS.md for project tracking
- No code changes this session — file placement only
