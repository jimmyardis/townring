# TownRing eval

```bash
python execution/eval.py                  # offline checks, all four cities
python execution/eval.py --all            # plus live site, voice API, Vapi config
python execution/eval.py --city chapin --all
python execution/eval.py --group data --group layers
python execution/eval.py --all --json report.json
./execution/eval_selftest.sh              # prove the eval can still fail
```

Exit code is non-zero if anything FAILs, so it can gate a deploy.

## Why each check exists

Every check corresponds to something that actually shipped broken:

| Fault that shipped | Check that would have caught it |
|---|---|
| `growth_pct` disagreed with each tract's own 2010/2020 counts in nearly every tract of every city, some with the wrong sign — feeding the **default** choropleth and `rank_tracts` for months | `growth_pct agrees with stored populations` |
| The Chapin map was byte-identical to the Columbia map, reporting 709,693 people for a town of 1,800 | `dataset is not a copy of another city` |
| Places carried no population, so "population of Chapin" was answered from the system prompt — 96,000, the whole region | `places carry population`, `the city's own town/city has a population` |
| A bare city name resolved to whichever lookup branch ran first: the region in Chapin, the county in Charleston and Sumter | `a bare city name is disambiguated, not answered as the region` |
| White Rock, Ballentine, West Ashley, Shaw AFB fell through to "couldn't find a place" | `colloquial names resolve` |
| Aggregate growth compared all tracts' 2020 population against only the ones existing in 2010 — Columbia advertised 52% where the truth is 4.7% | `summary growth uses a like-for-like basis` |
| The voice API sat on ACS 2020/2022 while the maps had moved to 2024, and never knew Sumter at all | `voice API knows this city with the right tract count`, `API rankings match the local data` |
| Three of four Vapi assistants silently lost their system prompt and all tools to a partial `model` PATCH, unnoticed for four months | `assistant is configured` |
| All ten Vapi tools lacked a server URL, so the Railway API was never called | `tools are split between server and client` |

## Groups

**Offline** (no network, run these constantly)

- `data` — integrity of the tract, place and summary files: counts agree, derived
  fields match their inputs, growth is null where a tract has no 2010 count, the
  ACS vintage is current, places have population, no city is a copy of another,
  radius-scoped cities stay inside their radius.
- `layers` — every metric `map.js` colours by exists in the tract data and has
  usable coverage, and the year slider offers no year without data. This is the
  check for "data layers per geography": a renamed or empty field means a layer
  renders blank, which looks like a styling bug and isn't.
- `tools` — runs the real `shared/place-lookup.js` through `eval_lookup.mjs`:
  bare city names, the city's own place, colloquial names, counties, tracts, and
  a nonsense name that must fail cleanly.

**Network**

- `live` — every city page and data file is served, shared assets are served, and
  the deployed summary matches the working tree (catches unpushed work and stale
  deploys).
- `api` — the Railway voice API knows each city with the right tract count, tool
  calls route to the right city by assistant id, its rankings match the local
  data, and its place lookup agrees with the browser's.
- `vapi` — each assistant has the expected model, voice, a system prompt that
  mentions its city, ten tools and no transcriber; and the five data tools have a
  server URL while the five map-control tools do not.

## Adding a city

Everything is driven from `CITIES` in `eval.py` plus the per-city data files, so a
new city needs only its slug added to that list and an entry in `ASSISTANTS` once
its Vapi assistant exists. The layer checks read `map.js` directly, so they pick up
whatever metrics that city defines.

## Keeping the eval honest

`eval_selftest.sh` injects four fault classes that have actually shipped, confirms
the eval reports a FAIL for each, and restores the files from git. It refuses to
run with uncommitted changes under `*/data/`, since it restores by `git checkout`.

Run it whenever the checks are changed. A suite that sits green for months is
worth exactly as much as its ability to go red.
