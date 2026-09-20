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

Re-check the remaining tools the same way `get_place_info` was checked — `set_metric`, `toggle_layer` and `scrub_year` have never been exercised against the live agent, and the growth bug showed that data faults hide behind tools that "work". Then call **+1 803-875-3246** (Chapin TalkMap) from a real phone and check whether the five server-side data tools answer. The browser path is verified; the phone path is not, because Vapi's Web SDK intercepts tool calls client-side so a browser test cannot exercise it.

## Blockers

- **The phone path is unverified.** The 5 data tools now carry a Railway server URL, but every browser test is answered client-side by `voice.js`, so only a real PSTN call to +1 803-875-3246 can confirm Vapi reaches the server. If it does not, the likely cause is assistant-to-tool version pinning — re-save the assistant after any tool edit.
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

### 2026-09-20 (later still — data faults found by user testing)

User reported "wonky" answers from the Chapin agent: asking for the population of Chapin returned 96,000, and some questions came back as "couldn't find that". Four separate faults behind it, three in the place lookup and one much bigger one in the tract data.

**1. Places carried no population.** The places GeoJSON held a name and a boundary and nothing else, so "population of Chapin town" returned a name with no number — and the model fell back to the only figure it had, the 96,000 Greater Chapin total in its own system prompt. That is where the wrong answer came from. `execution/enrich_places.py` now joins Census place-level population (decennial 2010/2020 plus ACS 2014-2024) onto every place in all four cities; Chapin town reads 1,809 for 2020, about 1,400 on the latest ACS.

**2. A bare name resolved to whichever branch ran first.** "Chapin" hit the map-area branch and returned 24 tracts typed as `city`. The same fault ran the other way in Charleston and Sumter, where the city name matches the county name — "population of Charleston" returned the county's 407,543 rather than the city's 150,227. The lookup now gathers every exact reading (place, county, map area) and returns all of them with a note telling the agent to lead with the place and say which figure it is quoting.

**3. Colloquial names had nowhere to land.** White Rock, Ballentine, Lake Murray, Dutch Fork, West Ashley, Shaw AFB — all real local names, none of them census geography, all falling through to "couldn't find a place", which sounds like a broken map. `shared/colloquial.json` describes them per city and the lookup explains they have no official population instead of failing.

**4. Per-tract growth was wrong almost everywhere.** Found while sweeping the other tools: `growth_pct` disagreed with each tract's own `pop_2010` and `pop_2020` in 14/14 comparable Chapin tracts, 134/134 Charleston, 133/133 Columbia, 20/20 Sumter. Some had the wrong sign — Sumter tract 16 read -17.5% where its counts give +7.3%; Columbia 115.02 read -45.8% against an actual +40.7%. This fed the **default** growth choropleth, the tract popups and `rank_tracts`, so the fastest-growing and declining lists were wrong as well. Chapin's top grower is tract 210.21 at 38.0%, not 213.03 at the 39.9% shown (really 25.9%). `execution/repair_growth.py` recomputes growth from the authoritative decennial counts, nulls it where a tract has no 2010 count, needs no network, and is safe to re-run.

**Consolidation.** The four `voice.js` files each carried their own copy of the place lookup (59 to 92 lines, all slightly different, all sharing the three bugs) — the same drift that had happened with the CSS. They now delegate to `shared/place-lookup.js`, and `execution/sync_api.sh` generates the CommonJS twin the phone API uses plus copies the data across, so browser and phone cannot answer the same question differently.

**Verified live** with a real voice call on townring.com/chapin: "What is the population of Chapin?" now answers "Chapin Town itself had about eighteen hundred people in twenty twenty... about fourteen hundred now," then offers the broader area — exactly the intended behaviour. Also swept all five data tools for Chapin; the other four were already sound.

**Lesson worth keeping:** a tool returning a well-formed response is not evidence the data behind it is right. `rank_tracts` had been "working" for months while ranking on a corrupt field.

### 2026-09-20 (later — voice)

**Switched all four assistants to OpenAI realtime.** `gpt-realtime-2025-08-28`, native speech-to-speech; Deepgram transcriber cleared on all four. Voices: Chapin `cedar`, Charleston `echo`, Columbia `marin`, Sumter `alloy` — four of the five realtime-compatible voices. Note this also swapped the brain from **claude-sonnet-4-6** to OpenAI's realtime model; latency improves, reasoning is weaker. Original configs backed up before any write.

**Found three of four assistants had been silently gutted.** Chapin, Charleston and Columbia had no system prompt and no tools — bare LLMs with a greeting. Only Sumter was intact.
- Root cause, from Vapi's assistant version history: on **2026-05-29 at 21:17–21:22** all three were PATCHed from `claude-3-5-sonnet-20241022` to `claude-sonnet-4-6` with a partial `model` object. Vapi replaces the whole `model` object, so `messages` and `toolIds` went with it. Chapin's 2026-05-26 version still had 1 prompt + 9 tools; the 2026-05-29 version has 0 and 0. Sumter escaped only because it was created 2026-05-28 already on sonnet-4-6 and was never re-PATCHed.
- **Lesson: never PATCH a Vapi assistant's `model` without carrying `messages` and `toolIds` forward.** Every write this session read the backup first and merged them back.
- Recovered the original prompts from version history rather than rewriting them, then updated each for this session's data changes: Chapin's scope (24 tracts / 95,832, with a rule not to answer Columbia-metro questions), Columbia's expansion to Richland + Lexington, ACS 2023 → 2024, year range 2014-2023 → 2014-2024, dropped `get_productivity_info` (no such Vapi tool), and gave all four the full set of 10 tools.
- Sumter's prompt claimed "grew 25.9% from 2010" — the inflated figure corrected earlier the same day. It now states plainly that Sumter is shrinking (about -3 percent, 107,800 in 2014 down to 104,700 in 2024).

**The Railway API was orphaned.** All 10 Vapi tools had no server URL, so nothing ever called `chapin-talkmap-api` — the browser worked only because `voice.js` implements every tool client-side. Split the tools: the 5 **data** tools (`get_place_info`, `rank_tracts`, `get_county_data`, `aggregate_tracts`, `get_tract_population_history`) now point at `/api/vapi-tool`; the 5 **map-control** tools stay client-side, since they drive a Mapbox canvas that does not exist on a phone call.

**City routing.** The 10 tools are shared by all four assistants, so a server-side call arrives not knowing which map the caller is on — the cross-city bleed that "Fix Charleston voice agent data confusion" already dealt with once. The server now resolves the city from the **assistant id** (which Vapi always sends and the model cannot forget), falling back to `?city=` then the old all-city search. Verified all four assistant ids route to their own city.

**Live test (3 calls, real Vapi credits).** Drove headless Chromium with a fake mic feeding a looped TTS question at the live Sumter page. Confirmed: realtime model connects, agent greets, hears the question, selects the right tool, and answers with the refreshed data ("about a hundred four thousand seven hundred" for 2024 — correct). First attempt died on `silence-timed-out` because the fake-audio file plays from page load, not call start; looping the question fixed it.
- The realtime model narrates numbers worse than Sonnet did — it said "104007" and "104000" for 104,725. Added a NUMBER RULE to all four prompts (years as one word-group, populations rounded and spoken in words, never invent digits); the retest then said "about 104,700". Transcripts still render years as "20 24", which may be Vapi's transcript formatting rather than the audio — worth an ear test.

**Also:** `~/.env` line 54 is a bare duplicate of the Vapi key with no variable name; it throws `command not found` whenever the file is sourced.

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
