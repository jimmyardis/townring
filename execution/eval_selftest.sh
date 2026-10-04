#!/usr/bin/env bash
# Prove the eval can still fail.
#
# An eval that always passes is worthless, and these checks will sit green for
# months at a time. This injects each fault class that actually shipped once,
# confirms the eval catches it, and restores the file from git.
#
# Requires a clean working tree: it restores by `git checkout`.
#
# Usage: execution/eval_selftest.sh

set -uo pipefail
cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain -- '*/data/' 2>/dev/null)" ]; then
  echo "Refusing to run: there are uncommitted changes under */data/."
  echo "This script restores by 'git checkout' and would discard them."
  exit 1
fi

PY=${PY:-/home/wner/venv/bin/python}
CITY=sumter
TRACTS="$CITY/data/$CITY-area-tracts.geojson"
PLACES="$CITY/data/$CITY-places.geojson"
pass=0; fail=0

# expect_fail <label> <group args> — the eval must report at least one FAIL.
# The output is captured rather than piped: eval.py exits non-zero when it
# finds a fault, and under `pipefail` that would mask grep's own result and
# report every caught fault as missed.
expect_fail() {
  local label="$1"; shift
  local out
  out="$($PY execution/eval.py --city "$CITY" "$@" --quiet 2>&1)"
  if printf '%s' "$out" | grep -q "^    FAIL"; then
    echo "  caught   $label"; pass=$((pass+1))
  else
    echo "  MISSED   $label"; fail=$((fail+1))
  fi
}

echo "Self-test: injecting faults that have actually shipped"

# 1. A derived field drifting from its inputs (the growth_pct bug).
$PY - <<EOF
import json
p="$TRACTS"; d=json.load(open(p))
for f in d["features"]:
    if f["properties"].get("pop_2010"):
        f["properties"]["growth_pct"] = 99.9; break
json.dump(d, open(p,"w"), separators=(",",":"))
EOF
expect_fail "growth_pct drifting from its own populations" --group data
git checkout -- "$TRACTS"

# 2. Places with no population (the "Chapin says 96,000" bug).
$PY - <<EOF
import json
p="$PLACES"; d=json.load(open(p))
for f in d["features"]:
    for k in [k for k in f["properties"] if k.startswith("pop_")]:
        del f["properties"][k]
json.dump(d, open(p,"w"), separators=(",",":"))
EOF
expect_fail "places carrying no population" --group data --group tools
git checkout -- "$PLACES"

# 3. One city's data being a copy of another's (the Chapin==Columbia bug).
cp chapin/data/chapin-area-tracts.geojson "$TRACTS"
expect_fail "dataset duplicated from another city" --group data
git checkout -- "$TRACTS"

# 4. A metric field renamed out from under map.js (layer renders blank).
$PY - <<EOF
import json
p="$TRACTS"; d=json.load(open(p))
for f in d["features"]:
    if "poverty_rate" in f["properties"]:
        f["properties"]["poverty_rate_OLD"] = f["properties"].pop("poverty_rate")
json.dump(d, open(p,"w"), separators=(",",":"))
EOF
expect_fail "metric field renamed out from under the map" --group layers
git checkout -- "$TRACTS"

echo
echo "$pass caught, $fail missed"
if [ -n "$(git status --porcelain -- '*/data/')" ]; then
  echo "WARNING: working tree not fully restored — check git status"; exit 1
fi
exit $(( fail > 0 ? 1 : 0 ))
