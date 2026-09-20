#!/usr/bin/env bash
# Push TownRing data + shared lookup into the voice API repo.
# The API answers the same tools on phone calls that voice.js answers in the
# browser, so both must read the same data and the same lookup logic.
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
API="${1:-$HOME/chapin-talkmap-api}"

for c in chapin charleston columbia sumter; do
  cp "$SRC/$c/data/$c-area-tracts.geojson" \
     "$SRC/$c/data/$c-places.geojson" \
     "$SRC/$c/data/$c-area-summary.json" "$API/data/"
done
cp "$SRC/shared/colloquial.json" "$API/data/"

# shared/place-lookup.js is an ES module for the browser; the API is CommonJS.
# Generate the CJS twin rather than maintaining two implementations.
{
  echo "/* GENERATED from townring/shared/place-lookup.js by execution/sync_api.sh."
  echo "   Do not edit here — edit the shared module and re-run the sync. */"
  sed 's/^export function/function/' "$SRC/shared/place-lookup.js"
  echo ""
  echo "module.exports = { lookupPlace };"
} > "$API/place-lookup.cjs"

echo "synced data + place-lookup.cjs -> $API"
