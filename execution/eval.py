#!/usr/bin/env python3
"""
TownRing — evaluation harness.

Every check here exists because something it would have caught actually shipped:

  * per-tract growth_pct disagreed with the tract's own 2010/2020 counts in
    nearly every tract of every city, some with the wrong sign, feeding the
    default choropleth and rank_tracts for months
  * the Chapin map was byte-identical to the Columbia map, reporting 709,693
    people for a town of 1,800
  * places carried no population, so the agent answered from its prompt
  * three of four Vapi assistants silently lost their system prompt and tools
  * the voice API drifted to a different ACS vintage than the maps

The lesson each time: a tool returning a well-formed answer is not evidence
the data behind it is right. So this checks the data, the layers the map draws
from it, the lookup behaviour, and the deployed copies of all three.

Usage:
  python execution/eval.py                       # offline groups, all cities
  python execution/eval.py --all                 # everything incl. network
  python execution/eval.py --city chapin --all
  python execution/eval.py --group data --group layers
  python execution/eval.py --all --json report.json

Groups: data, layers, tools (offline) · live, api, vapi (network)
Exit code is non-zero if any check FAILs, so it can gate a deploy.
"""

import argparse, json, os, re, subprocess, sys, urllib.request, urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CITIES = ["chapin", "charleston", "columbia", "sumter"]
OFFLINE_GROUPS = ["data", "layers", "tools"]
NETWORK_GROUPS = ["live", "api", "vapi"]

SITE = "https://townring.com"
API = "https://chapin-talkmap-api-production.up.railway.app"
EXPECTED_ACS = 2024
EXPECTED_MODEL = "gpt-realtime-2025-08-28"
ASSISTANTS = {
    "chapin":     ("ac689a99-081e-4f4e-8d80-746e6d7daa6a", "cedar"),
    "charleston": ("bdc929fb-5dbb-43ee-84f6-8f51b26c85b9", "echo"),
    "columbia":   ("eed4637f-c1f2-47f0-a896-f93c38532f1b", "marin"),
    "sumter":     ("e569e4e4-4cb2-4806-a1aa-9888d2381318", "alloy"),
}
SERVER_TOOLS = {"get_place_info", "rank_tracts", "get_county_data",
                "aggregate_tracts", "get_tract_population_history"}
CLIENT_TOOLS = {"fly_to_place", "set_metric", "scrub_year", "toggle_layer", "reset_view"}

PASS, FAIL, WARN, SKIP = "PASS", "FAIL", "WARN", "SKIP"


# ---------------------------------------------------------------- utilities

def http(url, method="GET", body=None, headers=None, timeout=30):
    req = urllib.request.Request(url, method=method,
                                 data=json.dumps(body).encode() if body else None,
                                 headers={"User-Agent": "TownRingEval/1.0",
                                          **({"Content-Type": "application/json"} if body else {}),
                                          **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read()


def http_json(url, **kw):
    _, raw = http(url, **kw)
    return json.loads(raw)


def vapi(path, key):
    # curl, not urllib: Vapi's edge 403s urllib's default client.
    out = subprocess.run(
        ["curl", "-s", "-m", "25", "-H", f"Authorization: Bearer {key}",
         f"https://api.vapi.ai{path}"], capture_output=True, text=True)
    return json.loads(out.stdout) if out.stdout.strip() else {}


def call_tool(assistant_id, tool, args):
    """Invoke a tool through the live API exactly as Vapi would."""
    return json.loads(http_json(f"{API}/api/vapi-tool", method="POST", body={
        "message": {"type": "tool-calls", "assistant": {"id": assistant_id},
                    "toolCallList": [{"id": "eval",
                                      "function": {"name": tool,
                                                   "arguments": json.dumps(args)}}]},
    })["results"][0]["result"])


def metric_properties(slug):
    """Tract properties the city's map.js colours by."""
    js = (ROOT / slug / "map.js").read_text()
    return sorted(set(re.findall(r"^\s*property:\s*'([a-z_0-9]+)'", js, re.M)))


def load(slug):
    d = ROOT / slug / "data"
    return {
        "tracts":  json.loads((d / f"{slug}-area-tracts.geojson").read_text())["features"],
        "places":  json.loads((d / f"{slug}-places.geojson").read_text())["features"],
        "summary": json.loads((d / f"{slug}-area-summary.json").read_text()),
    }


def lookup(slug, queries):
    out = subprocess.run(
        ["node", str(ROOT / "execution" / "eval_lookup.mjs"), slug, json.dumps(queries)],
        capture_output=True, text=True, cwd=ROOT)
    if out.returncode:
        raise RuntimeError(out.stderr.strip()[:300])
    return json.loads(out.stdout)


# ------------------------------------------------------------------- checks
# Each check: fn(slug, ctx) -> (status, detail). Registered via @check.

REGISTRY = []


def check(group, name):
    def deco(fn):
        REGISTRY.append((group, name, fn))
        return fn
    return deco


# ---- data -----------------------------------------------------------------

@check("data", "tract count matches summary")
def _(slug, ctx):
    n, claimed = len(ctx["tracts"]), ctx["summary"].get("total_tracts")
    return (PASS if n == claimed else FAIL), f"{n} tracts, summary says {claimed}"


@check("data", "growth_pct agrees with stored populations")
def _(slug, ctx):
    bad = []
    for f in ctx["tracts"]:
        p = f["properties"]
        a, b, g = p.get("pop_2010"), p.get("pop_2020"), p.get("growth_pct")
        if not a or b is None:
            continue
        expected = round((b - a) / a * 100, 1)
        if g is None or abs(expected - g) > 0.05:
            bad.append(f"{p.get('NAME')} {a}->{b} says {g}% is {expected}%")
    if bad:
        return FAIL, f"{len(bad)} tract(s) wrong; e.g. {bad[0]}"
    return PASS, "all comparable tracts consistent"


@check("data", "growth is null where the tract has no 2010 count")
def _(slug, ctx):
    bad = [f["properties"].get("NAME") for f in ctx["tracts"]
           if not f["properties"].get("pop_2010")
           and f["properties"].get("growth_pct") is not None]
    return (FAIL, f"{len(bad)} tract(s) claim growth without a 2010 count: {bad[:2]}") if bad \
        else (PASS, "no invented growth")


@check("data", "summary population matches the tracts")
def _(slug, ctx):
    s = ctx["summary"]
    total = sum(f["properties"].get("pop_2020") or 0 for f in ctx["tracts"])
    return (PASS if total == s.get("pop_2020") else FAIL), \
        f"tracts sum {total:,}, summary {s.get('pop_2020'):,}"


@check("data", "summary growth uses a like-for-like basis")
def _(slug, ctx):
    s = ctx["summary"]
    comp = [f["properties"] for f in ctx["tracts"]
            if f["properties"].get("pop_2010") and f["properties"].get("pop_2020")]
    a = sum(p["pop_2010"] for p in comp)
    b = sum(p["pop_2020"] for p in comp)
    expected = round((b - a) / a * 100, 1) if a else None
    got = s.get("growth_pct_2010_2020")
    if got is None:
        return FAIL, "summary has no growth figure"
    if abs(got - expected) > 0.05:
        return FAIL, (f"summary says {got}%, like-for-like over {len(comp)} comparable "
                      f"tracts is {expected}% (naive all-tract sum inflates this)")
    if not s.get("growth_basis"):
        return WARN, f"{got}% correct but growth_basis missing"
    return PASS, f"{got}% over {len(comp)}/{len(ctx['tracts'])} comparable tracts"


@check("data", "ACS vintage is current")
def _(slug, ctx):
    v = ctx["summary"].get("acs_vintage")
    return (PASS if v == EXPECTED_ACS else FAIL), f"acs_vintage={v}, expected {EXPECTED_ACS}"


@check("data", "annual population series is complete")
def _(slug, ctx):
    years = list(range(2014, EXPECTED_ACS + 1))
    missing = [y for y in years
               if sum(1 for f in ctx["tracts"] if f["properties"].get(f"pop_{y}") is not None)
               < len(ctx["tracts"]) * 0.5]
    return (FAIL, f"years with <50% coverage: {missing}") if missing \
        else (PASS, f"pop_{years[0]}..pop_{years[-1]} present")


@check("data", "places carry population")
def _(slug, ctx):
    without = [f["properties"].get("display_name") for f in ctx["places"]
               if f["properties"].get("pop_2020_dec") is None
               and f["properties"].get(f"pop_{EXPECTED_ACS}") is None]
    if without:
        return FAIL, (f"{len(without)}/{len(ctx['places'])} places have no population "
                      f"— the agent will answer from its prompt instead: {without[:3]}")
    return PASS, f"all {len(ctx['places'])} places have population"


@check("data", "dataset is not a copy of another city")
def _(slug, ctx):
    mine = {f["properties"].get("GEOID") for f in ctx["tracts"]}
    for other in CITIES:
        if other == slug:
            continue
        try:
            theirs = {f["properties"].get("GEOID") for f in load(other)["tracts"]}
        except Exception:
            continue
        if mine == theirs:
            return FAIL, (f"identical tract set to {other} — two configs covering the same "
                          f"counties produce the same map; scope one with radius_km")
    return PASS, "tract set is distinct"


@check("data", "radius-scoped cities stay inside their radius")
def _(slug, ctx):
    import math
    s = ctx["summary"]
    r = s.get("radius_km")
    if not r:
        return SKIP, "whole-county build"
    c = s["center"]

    def km(lon, lat):
        R = 6371.0
        p1, p2 = math.radians(c["lat"]), math.radians(lat)
        h = (math.sin((p2 - p1) / 2) ** 2
             + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon - c["lng"]) / 2) ** 2)
        return 2 * R * math.asin(math.sqrt(h))

    try:
        from shapely.geometry import shape
    except ImportError:
        return SKIP, "shapely not available"
    out = []
    for f in ctx["tracts"]:
        cen = shape(f["geometry"]).centroid
        if km(cen.x, cen.y) > r + 0.5:
            out.append(f["properties"].get("NAME"))
    return (FAIL, f"{len(out)} tract(s) outside {r} km: {out[:2]}") if out \
        else (PASS, f"all {len(ctx['tracts'])} tracts within {r} km")


# ---- layers ---------------------------------------------------------------

@check("layers", "every map metric has a field in the tract data")
def _(slug, ctx):
    props = metric_properties(slug)
    if not props:
        return FAIL, "no metrics parsed from map.js"
    keys = set()
    for f in ctx["tracts"][:50]:
        keys |= set(f["properties"])
    missing = [p for p in props if p not in keys]
    return (FAIL, f"{len(missing)} metric(s) reference fields that do not exist: {missing}") if missing \
        else (PASS, f"{len(props)} metrics, all fields present")


@check("layers", "every map metric has usable coverage")
def _(slug, ctx):
    props = metric_properties(slug)
    n = len(ctx["tracts"])
    thin, empty = [], []
    for p in props:
        have = sum(1 for f in ctx["tracts"] if f["properties"].get(p) is not None)
        pct = have / n * 100 if n else 0
        if have == 0:
            empty.append(p)
        elif pct < 50:
            thin.append(f"{p} {pct:.0f}%")
    if empty:
        return FAIL, f"metric(s) with no data at all — the layer renders blank: {empty}"
    if thin:
        return WARN, f"sparse layers: {thin}"
    return PASS, f"all {len(props)} layers above 50% coverage"


@check("layers", "the year slider has a value for every year")
def _(slug, ctx):
    js = (ROOT / slug / "map.js").read_text()
    m = re.search(r"years:\s*\[([0-9,\s]+)\]", js)
    if not m:
        return SKIP, "no year-aware metric"
    years = [int(y) for y in m.group(1).replace(" ", "").strip(",").split(",")]
    n = len(ctx["tracts"])
    bad = [y for y in years
           if sum(1 for f in ctx["tracts"] if f["properties"].get(f"pop_{y}") is not None) < n * 0.5]
    return (FAIL, f"slider offers years with no data: {bad}") if bad \
        else (PASS, f"{years[0]}-{years[-1]} all populated")


# ---- tools ----------------------------------------------------------------

@check("tools", "a bare city name is disambiguated, not answered as the region")
def _(slug, ctx):
    city = ctx["summary"]["city"]
    r = lookup(slug, [city])[city]
    if r.get("type") == "map_area":
        return FAIL, (f'"{city}" answers with the whole {r.get("total_tracts")}-tract area as if it '
                      f"were the town — this is how Chapin reported 96,000 people")
    if r.get("type") == "county":
        return FAIL, f'"{city}" answers with the county, not the place'
    if r.get("ambiguous"):
        return PASS, f"ambiguous with {sorted(k for k in r if k in ('place','county','area'))}"
    if r.get("population_2020") is not None:
        return PASS, f"resolves to {r.get('name')} ({r['population_2020']:,})"
    return FAIL, f"unexpected shape: {list(r)[:5]}"


@check("tools", "the city's own town/city has a population")
def _(slug, ctx):
    city = ctx["summary"]["city"]
    r = lookup(slug, [city])[city]
    place = r.get("place") or r.get("town") or (r if r.get("type") != "map_area" else {})
    pop = place.get("population_2020") or place.get("population_latest")
    return (PASS, f"{place.get('name')} = {pop:,}") if pop \
        else (FAIL, f"no population for the {city} place itself")


@check("tools", "colloquial names resolve")
def _(slug, ctx):
    table = json.loads((ROOT / "shared" / "colloquial.json").read_text()).get(slug, {})
    if not table:
        return WARN, "no colloquial names defined for this city"
    res = lookup(slug, list(table))
    bad = [q for q, r in res.items() if r.get("error") or r.get("type") != "colloquial_area"]
    return (FAIL, f"{len(bad)} colloquial name(s) fall through to an error: {bad[:3]}") if bad \
        else (PASS, f"all {len(table)} resolve")


@check("tools", "counties resolve")
def _(slug, ctx):
    counties = ctx["summary"].get("counties") or []
    if not counties:
        return FAIL, "summary lists no counties"
    res = lookup(slug, counties)
    bad = [c for c, r in res.items()
           if r.get("error") or (r.get("type") != "county" and not r.get("county"))]
    return (FAIL, f"county lookup failed: {bad}") if bad else (PASS, f"{', '.join(counties)}")


@check("tools", "a census tract resolves by number")
def _(slug, ctx):
    name = next((f["properties"].get("NAME") for f in ctx["tracts"]
                 if f["properties"].get("NAME")), None)
    if not name:
        return SKIP, "no tract names"
    num = name.replace("Census Tract", "").strip()
    r = lookup(slug, [num])[num]
    return (PASS, f'"{num}" -> {r.get("name")}') if r.get("type") == "census_tract" \
        else (FAIL, f'"{num}" did not resolve to a tract (got {r.get("type") or r.get("error")})')


@check("tools", "an unknown name fails cleanly")
def _(slug, ctx):
    q = "Zzyzx Nowhere Township"
    r = lookup(slug, [q])[q]
    if not r.get("error"):
        return FAIL, f"nonsense name matched something: {r.get('name')}"
    return (PASS, "returns an error with a suggestion") if r.get("suggestion") \
        else (WARN, "errors but offers no suggestion")


# ---- live -----------------------------------------------------------------

@check("live", "city page is up")
def _(slug, ctx):
    try:
        code, body = http(f"{SITE}/{slug}/")
        return (PASS if code == 200 else FAIL), f"HTTP {code}, {len(body)} bytes"
    except Exception as e:
        return FAIL, str(e)[:120]


@check("live", "data files are served")
def _(slug, ctx):
    names = [f"{slug}-area-tracts.geojson", f"{slug}-places.geojson",
             f"{slug}-area-summary.json", f"{slug}-cinematic-shapes.geojson"]
    bad = []
    for n in names:
        try:
            code, _ = http(f"{SITE}/{slug}/data/{n}")
            if code != 200:
                bad.append(f"{n} HTTP {code}")
        except Exception as e:
            bad.append(f"{n} {type(e).__name__}")
    return (FAIL, "; ".join(bad)) if bad else (PASS, f"all {len(names)} files 200")


@check("live", "shared assets are served")
def _(slug, ctx):
    if slug != CITIES[0]:
        return SKIP, "checked once"
    bad = []
    for n in ["mobile.css", "mobile.js", "place-lookup.js", "colloquial.json"]:
        try:
            code, _ = http(f"{SITE}/shared/{n}")
            if code != 200:
                bad.append(f"{n} HTTP {code}")
        except Exception as e:
            bad.append(f"{n} {type(e).__name__}")
    return (FAIL, "; ".join(bad)) if bad else (PASS, "mobile + lookup assets 200")


@check("live", "deployed data matches the working tree")
def _(slug, ctx):
    try:
        live = json.loads(http(f"{SITE}/{slug}/data/{slug}-area-summary.json")[1])
    except Exception as e:
        return FAIL, str(e)[:120]
    local = ctx["summary"]
    diffs = [k for k in ("total_tracts", "pop_2020", "growth_pct_2010_2020", "acs_vintage")
             if live.get(k) != local.get(k)]
    return (FAIL, f"live differs from local on {diffs} — unpushed work or a stale deploy") if diffs \
        else (PASS, "live summary matches local")


# ---- api ------------------------------------------------------------------

@check("api", "voice API knows this city with the right tract count")
def _(slug, ctx):
    try:
        root = http_json(f"{API}/")
    except Exception as e:
        return FAIL, str(e)[:120]
    entry = next((c for c in root.get("cities", []) if c.get("slug") == slug), None)
    if not entry:
        return FAIL, f"API does not serve {slug} — phone calls will find nothing"
    n = ctx["summary"]["total_tracts"]
    return (PASS if entry.get("tracts") == n else FAIL), \
        f"API has {entry.get('tracts')} tracts, maps have {n}"


@check("api", "tool calls route to this city")
def _(slug, ctx):
    aid = ASSISTANTS[slug][0]
    try:
        r = call_tool(aid, "rank_tracts", {"direction": "most_populous_2020", "count": 1})
    except Exception as e:
        return FAIL, str(e)[:120]
    got = (r.get("tracts") or [{}])[0].get("city")
    return (PASS if got == ctx["summary"]["city"] else FAIL), \
        f"assistant returned {got!r}, expected {ctx['summary']['city']!r}"


@check("api", "API rankings match the local data")
def _(slug, ctx):
    aid = ASSISTANTS[slug][0]
    try:
        r = call_tool(aid, "rank_tracts", {"direction": "fastest_growing", "count": 1})
    except Exception as e:
        return FAIL, str(e)[:120]
    api_top = (r.get("tracts") or [{}])[0]
    local = sorted((f["properties"] for f in ctx["tracts"] if f["properties"].get("has_2010")),
                   key=lambda p: p.get("growth_pct") or 0, reverse=True)
    if not local:
        return SKIP, "no comparable tracts"
    exp = local[0]
    if api_top.get("name") != exp.get("NAME"):
        return FAIL, (f"API's fastest-growing is {api_top.get('name')} "
                      f"({api_top.get('growth_pct')}%), local data says {exp.get('NAME')} "
                      f"({exp.get('growth_pct')}%) — the API's data is stale")
    return PASS, f"{exp.get('NAME')} at {exp.get('growth_pct')}%"


@check("api", "place lookup agrees with the browser")
def _(slug, ctx):
    city = ctx["summary"]["city"]
    aid = ASSISTANTS[slug][0]
    try:
        api_r = call_tool(aid, "get_place_info", {"name": city})
    except Exception as e:
        return FAIL, str(e)[:120]
    web_r = lookup(slug, [city])[city]
    same_shape = (bool(api_r.get("ambiguous")) == bool(web_r.get("ambiguous"))
                  and api_r.get("type") == web_r.get("type"))
    return (PASS, "phone and browser agree") if same_shape else \
        (FAIL, f"phone returns {api_r.get('type') or 'ambiguous'}, "
               f"browser returns {web_r.get('type') or 'ambiguous'}")


# ---- vapi -----------------------------------------------------------------

def _vapi_key():
    env = ROOT.parent / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("VAPI_PRIVATE_KEY="):
                return line.split("=", 1)[1].strip()
    return os.environ.get("VAPI_PRIVATE_KEY", "")


@check("vapi", "assistant is configured")
def _(slug, ctx):
    key = _vapi_key()
    if not key:
        return SKIP, "no VAPI_PRIVATE_KEY"
    aid, voice = ASSISTANTS[slug]
    a = vapi(f"/assistant/{aid}", key)
    if not a or a.get("message"):
        return FAIL, f"could not read assistant: {str(a)[:100]}"
    m = a.get("model") or {}
    problems = []
    if m.get("model") != EXPECTED_MODEL:
        problems.append(f"model={m.get('model')}")
    if (a.get("voice") or {}).get("voiceId") != voice:
        problems.append(f"voice={(a.get('voice') or {}).get('voiceId')}")
    prompt = (m.get("messages") or [{}])[0].get("content", "")
    if len(prompt) < 500:
        problems.append(f"system prompt is {len(prompt)} chars — a partial model PATCH wipes it")
    elif ctx["summary"]["city"].lower() not in prompt.lower():
        problems.append("prompt does not mention the city")
    if len(m.get("toolIds") or []) != 10:
        problems.append(f"{len(m.get('toolIds') or [])} tools, expected 10")
    if a.get("transcriber"):
        problems.append("transcriber set on a realtime model")
    return (FAIL, "; ".join(problems)) if problems else \
        (PASS, f"{EXPECTED_MODEL}, voice {voice}, 10 tools, {len(prompt)}-char prompt")


@check("vapi", "tools are split between server and client")
def _(slug, ctx):
    if slug != CITIES[0]:
        return SKIP, "checked once"
    key = _vapi_key()
    if not key:
        return SKIP, "no VAPI_PRIVATE_KEY"
    tools = vapi("/tool?limit=40", key)
    if not isinstance(tools, list):
        return FAIL, f"could not list tools: {str(tools)[:100]}"
    by_name = {(t.get("function") or {}).get("name"): t for t in tools}
    problems = []
    for n in SERVER_TOOLS:
        t = by_name.get(n)
        if not t:
            problems.append(f"{n} missing")
        elif not (t.get("server") or {}).get("url"):
            problems.append(f"{n} has no server URL — phone calls cannot answer it")
    for n in CLIENT_TOOLS:
        t = by_name.get(n)
        if t and (t.get("server") or {}).get("url"):
            problems.append(f"{n} points at a server but drives the browser map")
    return (FAIL, "; ".join(problems)) if problems else \
        (PASS, f"{len(SERVER_TOOLS)} server-side, {len(CLIENT_TOOLS)} client-side")


# -------------------------------------------------------------------- runner

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--city", action="append", choices=CITIES)
    ap.add_argument("--group", action="append", choices=OFFLINE_GROUPS + NETWORK_GROUPS)
    ap.add_argument("--all", action="store_true", help="include the network groups")
    ap.add_argument("--json", metavar="PATH", help="also write a machine-readable report")
    ap.add_argument("--quiet", action="store_true", help="only show FAIL and WARN")
    args = ap.parse_args()

    cities = args.city or CITIES
    groups = args.group or (OFFLINE_GROUPS + NETWORK_GROUPS if args.all else OFFLINE_GROUPS)

    mark = {PASS: "ok  ", FAIL: "FAIL", WARN: "warn", SKIP: "--  "}
    counts = {PASS: 0, FAIL: 0, WARN: 0, SKIP: 0}
    report = {}

    print(f"\nTownRing eval — {len(cities)} cit{'y' if len(cities)==1 else 'ies'}, "
          f"groups: {', '.join(groups)}\n" + "=" * 72)

    for slug in cities:
        try:
            ctx = load(slug)
        except Exception as e:
            print(f"\n{slug}: could not load data — {e}")
            counts[FAIL] += 1
            continue

        print(f"\n{slug.upper()}  ({ctx['summary'].get('total_tracts')} tracts, "
              f"{ctx['summary'].get('pop_2020', 0):,} people)")
        report[slug] = {}
        last_group = None
        for group, name, fn in REGISTRY:
            if group not in groups:
                continue
            if group != last_group:
                print(f"  [{group}]")
                last_group = group
            try:
                status, detail = fn(slug, ctx)
            except Exception as e:
                status, detail = FAIL, f"check raised {type(e).__name__}: {str(e)[:150]}"
            counts[status] += 1
            report[slug][name] = {"group": group, "status": status, "detail": detail}
            if args.quiet and status in (PASS, SKIP):
                continue
            print(f"    {mark[status]}  {name}")
            if status != PASS or not args.quiet:
                print(f"          {detail}")

    print("\n" + "=" * 72)
    print(f"{counts[PASS]} passed · {counts[FAIL]} failed · "
          f"{counts[WARN]} warnings · {counts[SKIP]} skipped")

    if args.json:
        Path(args.json).write_text(json.dumps(report, indent=2))
        print(f"report written to {args.json}")

    if counts[FAIL]:
        print("\nFAILURES:")
        for slug, checks in report.items():
            for name, r in checks.items():
                if r["status"] == FAIL:
                    print(f"  {slug}: {name}\n      {r['detail']}")

    return 1 if counts[FAIL] else 0


if __name__ == "__main__":
    sys.exit(main())
