/* Harness so eval.py can exercise the real browser place-lookup.
   Usage: node execution/eval_lookup.mjs <slug> '["Chapin","White Rock"]'
   Prints {query: result} as JSON. */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const slug = process.argv[2];
const queries = JSON.parse(process.argv[3] || '[]');

const read = p => JSON.parse(readFileSync(p, 'utf-8'));
const DATA = {
  tracts:  read(join(root, slug, 'data', `${slug}-area-tracts.geojson`)),
  places:  read(join(root, slug, 'data', `${slug}-places.geojson`)),
  summary: read(join(root, slug, 'data', `${slug}-area-summary.json`)),
  colloquial: (read(join(root, 'shared', 'colloquial.json')))[slug] || {},
};

const { lookupPlace } = await import(
  pathToFileURL(join(root, 'shared', 'place-lookup.js')).href
);

const out = {};
for (const q of queries) out[q] = lookupPlace(q, DATA, slug);
console.log(JSON.stringify(out));
