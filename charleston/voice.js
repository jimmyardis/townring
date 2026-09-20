/* ============================================================
   Charleston Map — Voice Agent
   Client-side Vapi SDK + 9 voice tools (4 data, 5 map control)
   ============================================================ */

import Vapi from 'https://esm.sh/@vapi-ai/web@latest';
import { lookupPlace } from '../shared/place-lookup.js';

// =============================================================
// VAPI CREDENTIALS
// =============================================================
const VAPI_PUBLIC_KEY   = '046d7e78-64ab-404b-ad0e-e6c3e800bd41';
const VAPI_ASSISTANT_ID = 'bdc929fb-5dbb-43ee-84f6-8f51b26c85b9';

// =============================================================
// Data cache — loaded once at startup
// =============================================================
let DATA = { tracts: null, places: null, summary: null, productivity: null, loaded: false };

async function loadData() {
  try {
    const [tracts, places, summary, productivity, colloquial] = await Promise.all([
      fetch('data/charleston-area-tracts.geojson').then(r => r.json()),
      fetch('data/charleston-places.geojson').then(r => r.json()),
      fetch('data/charleston-area-summary.json').then(r => r.json()),
      fetch('productivity/three-area/summary.json').then(r => r.json()),
      fetch('../shared/colloquial.json').then(r => r.json()).then(d => d['charleston'] || {}).catch(() => ({})),
    ]);
    DATA = { tracts, places, summary, productivity, loaded: true };
    console.log(`Voice data loaded: ${tracts.features.length} tracts, ${places.features.length} places.`);
  } catch (err) {
    console.warn('Voice data not loaded (run data pipeline first):', err.message);
  }
}
loadData();

// =============================================================
// TOOLS
// =============================================================
const num      = (v) => v == null ? 'n/a' : Number(v).toLocaleString();
const pct      = (v) => v == null ? 'n/a' : (v >= 0 ? '+' : '') + Number(v).toFixed(1) + '%';
const fmtYears = (obj) => Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [k, num(v)]));

const TOOLS = {

  /**
   * Look up info about a named place: county, city, CDP, tract, or colloquial area.
   */
  get_place_info({ name }) {
    if (!DATA.loaded) return { error: 'Data not loaded yet — try again in a moment.' };
    return lookupPlace(name, DATA, 'charleston');
  },

  /**
   * Rank tracts by a metric — fastest growing, declining, wealthiest, youngest, etc.
   * direction: 'fastest_growing' | 'declining' | 'most_populous' | 'highest_income' | 'lowest_income' | 'youngest' | 'oldest' | 'most_diverse'
   */
  rank_tracts({ direction = 'fastest_growing', count = 5, county = null }) {
    if (!DATA.loaded) return { error: 'Data not loaded yet.' };

    let pool = DATA.tracts.features;
    if (county) {
      const cn = String(county).toLowerCase();
      pool = pool.filter(f => String(f.properties.county_name || '').toLowerCase().includes(cn));
    }

    const sorters = {
      fastest_growing:  (a, b) => (b.properties.growth_pct ?? -999) - (a.properties.growth_pct ?? -999),
      declining:        (a, b) => (a.properties.growth_pct ?? 999) - (b.properties.growth_pct ?? 999),
      most_populous:    (a, b) => (b.properties.pop_2020 ?? 0) - (a.properties.pop_2020 ?? 0),
      highest_income:   (a, b) => (b.properties.median_income ?? 0) - (a.properties.median_income ?? 0),
      lowest_income:    (a, b) => (a.properties.median_income ?? 999999) - (b.properties.median_income ?? 999999),
      youngest:         (a, b) => (a.properties.median_age ?? 999) - (b.properties.median_age ?? 999),
      oldest:           (a, b) => (b.properties.median_age ?? 0) - (a.properties.median_age ?? 0),
      most_diverse:     (a, b) => (b.properties.pct_nonwhite ?? 0) - (a.properties.pct_nonwhite ?? 0),
    };

    if (direction === 'fastest_growing' || direction === 'declining') {
      pool = pool.filter(f => f.properties.has_2010 === true || f.properties.has_2010 === 'true');
    }

    const sorter = sorters[direction];
    if (!sorter) return { error: `Unknown direction "${direction}". Options: ${Object.keys(sorters).join(', ')}.` };
    pool = [...pool].sort(sorter);

    return {
      direction,
      county_filter: county || 'all tri-county',
      count: Math.min(count, pool.length),
      tracts: pool.slice(0, count).map(f => ({
        name: f.properties.NAME,
        county: f.properties.county_name,
        population_2020: num(f.properties.pop_2020),
        growth_pct: pct(f.properties.growth_pct),
        median_income: num(f.properties.median_income),
        median_age: f.properties.median_age,
        pct_nonwhite: f.properties.pct_nonwhite,
      })),
    };
  },

  /**
   * County-level population by year — supports Charleston, Berkeley, Dorchester, or all.
   */
  get_county_data({ county = 'all', year = null }) {
    if (!DATA.loaded) return { error: 'Data not loaded yet.' };
    const yearsByCounty = DATA.summary?.county_population_by_year || {};

    const result = {};
    const keys = (county === 'all' || county === 'tri-county') ? Object.keys(yearsByCounty) : [county];
    for (const k of keys) {
      const matched = Object.keys(yearsByCounty).find(c => c.toLowerCase().includes(String(k).toLowerCase()));
      if (!matched) continue;
      const data = yearsByCounty[matched];
      result[matched] = year ? { [year]: num(data[year] || data[String(year)]) } : fmtYears(data);
    }
    return Object.keys(result).length === 0
      ? { error: `No data for county "${county}". Options: Charleston, Berkeley, Dorchester.` }
      : { counties: result };
  },

  /**
   * Aggregate a metric across a named area — sum or average.
   * area: 'Greater Charleston' | 'Charleston County' | 'Berkeley County' | 'Dorchester County'
   * metric: 'pop_2020' | 'pop_2010' | 'growth_abs' | 'median_income' | 'pct_nonwhite'
   * agg: 'sum' | 'average'
   */
  aggregate_tracts({ area, metric = 'pop_2020', agg = 'sum' }) {
    if (!DATA.loaded) return { error: 'Data not loaded yet.' };
    if (!area) return { error: 'Need an area name.' };
    const a = String(area).toLowerCase();

    let pool;
    if (a.includes('greater') || a.includes('metro') || a.includes('tri')) {
      pool = DATA.tracts.features.filter(f => f.properties.is_greater_charleston);
    } else if (a.includes('charleston') && !a.includes('berkeley') && !a.includes('dorchester')) {
      pool = DATA.tracts.features.filter(f => f.properties.county_name === 'Charleston');
    } else if (a.includes('berkeley')) {
      pool = DATA.tracts.features.filter(f => f.properties.county_name === 'Berkeley');
    } else if (a.includes('dorchester')) {
      pool = DATA.tracts.features.filter(f => f.properties.county_name === 'Dorchester');
    } else {
      return { error: `Unknown area "${area}". Try: Greater Charleston, Charleston County, Berkeley County, Dorchester County.` };
    }

    const values = pool.map(f => f.properties[metric]).filter(v => v != null && !isNaN(v));
    if (!values.length) return { error: `No data for metric "${metric}" in "${area}".` };

    const total = values.reduce((s, v) => s + Number(v), 0);
    const avg = total / values.length;

    return {
      area,
      metric,
      tract_count: pool.length,
      tract_count_with_data: values.length,
      sum: agg === 'sum' ? num(total) : undefined,
      average: agg === 'average' ? Math.round(avg * 10) / 10 : undefined,
      result: agg === 'sum' ? num(total) : Math.round(avg * 10) / 10,
    };
  },

  /**
   * Return tax productivity stats for a named study area.
   * area: 'walled city' | 'cena' | 'west ashley' | 'all'
   */
  get_productivity_info({ area = 'all' }) {
    if (!DATA.loaded) return { error: 'Data not loaded yet.' };
    const prod = DATA.productivity;
    if (!prod) return { error: 'Productivity data not loaded.' };
    const areas = prod.areas || {};
    const a = String(area).toLowerCase().trim();

    const fmt = (v) => v != null ? Math.round(v).toLocaleString() : 'n/a';

    // Return specific area
    const keys = Object.keys(areas);
    const matched = keys.find(k => {
      const kl = k.toLowerCase();
      return kl.includes(a) || a.includes(kl) ||
        (a.includes('walled') && kl.includes('walled')) ||
        (a.includes('cena') && kl.includes('cena')) ||
        (a.includes('west') && kl.includes('west'));
    });

    if (matched) {
      const d = areas[matched];
      return {
        area: d.name,
        description: d.description,
        parcels: d.n,
        acres: Math.round(d.polygon_acres * 10) / 10,
        annual_tax: '$' + fmt(d.tax),
        tax_per_acre: '$' + fmt(d.tpa) + '/acre',
        value_per_acre: '$' + fmt(d.vpa) + '/acre',
        taxable_tax_per_acre: '$' + fmt(d.tpa_taxable) + '/acre (taxable land only)',
        pct_civic_exempt: d.n_civic ? Math.round(d.n_civic / d.n * 100) + '%' : 'n/a',
        owner_occupied: d.n_oo ? Math.round(d.n_oo / d.n * 100) + '%' : 'n/a',
      };
    }

    // Return comparison of all areas
    if (a === 'all' || a === 'compare' || a === 'comparison') {
      return {
        comparison: keys.map(k => {
          const d = areas[k];
          return { area: d.short, tax_per_acre: '$' + fmt(d.tpa), annual_tax: '$' + fmt(d.tax), acres: Math.round(d.polygon_acres) };
        }),
        insight: `The Walled City generates $${fmt(areas['Walled City']?.tpa)}/acre — ${Math.round((areas['Walled City']?.tpa || 0) / (areas['West Ashley']?.tpa || 1))}x more than West Ashley's $${fmt(areas['West Ashley']?.tpa)}/acre.`,
      };
    }

    return { error: `Unknown area "${area}". Options: Walled City, CENA, West Ashley, all.` };
  },

  // ---- Client-side map control tools ----

  fly_to_place({ place, name, target, location }) {
    const p = place || name || target || location;
    return window.charlestonMap?.flyToPlace?.(p) ?? { error: 'Map not initialized.' };
  },

  set_metric({ metric }) {
    return window.charlestonMap?.setMetric?.(metric) ?? { error: 'Map not initialized.' };
  },

  reset_view() {
    return window.charlestonMap?.resetView?.() ?? { error: 'Map not initialized.' };
  },

  /**
   * Scrub the annual population layer to a specific year (2014–2024).
   */
  scrub_year({ year }) {
    return window.charlestonMap?.setYear?.(year) ?? { error: 'Map not initialized.' };
  },

  /**
   * Toggle a named layer on or off.
   * layer: 'cinematic' | 'places' | 'census' | '3d'
   */
  toggle_layer({ layer }) {
    if (!layer) return { error: 'Need a layer name: cinematic, places, census, 3d.' };
    const l = String(layer).toLowerCase().trim();
    const map = window.charlestonMap;
    if (!map) return { error: 'Map not initialized.' };

    if (l === 'cinematic' || l === 'focus' || l === 'space view') {
      return map.toggleCinematic?.() ?? { error: 'Map not initialized.' };
    }
    if (l === 'places' || l === 'boundaries' || l === 'towns') {
      return map.togglePlaces?.() ?? { error: 'Map not initialized.' };
    }
    if (l === 'census' || l === 'data' || l === 'choropleth' || l === 'color') {
      return map.toggleCensus?.() ?? { error: 'Map not initialized.' };
    }
    if (l === '3d' || l === 'three d' || l === 'flat' || l === '2d' || l === 'tilt') {
      return map.toggle3D?.() ?? { error: 'Map not initialized.' };
    }
    if (l === 'productivity' || l === 'tax' || l === 'parcels' || l === 'per acre' ||
        l === '$/acre' || l === 'tax per acre' || l === 'walled city') {
      return map.toggleProductivity?.() ?? { error: 'Map not initialized.' };
    }
    return { error: `Unknown layer "${layer}". Options: cinematic, places, census, 3d, productivity.` };
  },
};

// =============================================================
// VAPI INIT
// =============================================================
if (typeof Vapi === 'undefined') {
  console.error('Vapi SDK not loaded. Check the CDN script tag in index.html.');
}

const vapi = new Vapi(VAPI_PUBLIC_KEY);

const voiceBtn    = document.getElementById('voiceBtn');
const voiceStatus = document.getElementById('voiceStatus');
const transcriptEl = document.getElementById('transcript');
const btnLabel    = voiceBtn.querySelector('.label');
let callActive = false;

voiceBtn.addEventListener('click', () => {
  if (!callActive) {
    setStatus('Connecting…', true);
    vapi.start(VAPI_ASSISTANT_ID);
  } else {
    vapi.stop();
  }
});

vapi.on('call-start', () => {
  callActive = true;
  voiceBtn.classList.add('active');
  btnLabel.textContent = 'End call';
  setStatus('Connected', true);
});

vapi.on('call-end', () => {
  callActive = false;
  voiceBtn.classList.remove('active', 'speaking', 'listening');
  btnLabel.textContent = 'Talk to the Map';
  setStatus('', false);
  transcriptEl.classList.remove('visible');
});

vapi.on('speech-start', () => {
  voiceBtn.classList.add('speaking');
  voiceBtn.classList.remove('listening');
  setStatus('Speaking…', true);
});

vapi.on('speech-end', () => {
  voiceBtn.classList.remove('speaking');
  voiceBtn.classList.add('listening');
  setStatus('Listening…', true);
});

vapi.on('message', async (msg) => {
  if (msg.type !== 'transcript' && msg.type !== 'speech-update' && msg.type !== 'voice-input') {
    console.log('[Vapi msg]', msg.type, msg);
  }

  const toolCallList =
    msg.toolCallList || msg.tool_calls || msg.toolCalls ||
    (msg.functionCall ? [{ id: msg.functionCall.id || `fn_${Date.now()}`, function: msg.functionCall }] : null);

  const isToolMsg = msg.type === 'tool-calls' || msg.type === 'function-call' ||
    (toolCallList && toolCallList.length > 0);

  if (isToolMsg && toolCallList?.length) {
    for (const call of toolCallList) {
      const fnName = call.function?.name || call.name;
      const rawArgs = call.function?.arguments ?? call.arguments ?? '{}';
      let args;
      try { args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs; }
      catch { args = {}; }

      const fn = TOOLS[fnName];
      let result;
      if (!fn) {
        result = { error: `Unknown tool "${fnName}". Available: ${Object.keys(TOOLS).join(', ')}.` };
      } else {
        try { result = await fn(args || {}); }
        catch (e) { result = { error: String(e?.message || e) }; }
      }

      console.log(`🔧 [tool] ${fnName}(${JSON.stringify(args)}) →`, result);

      const callId = call.id || call.toolCallId || call.tool_call_id || `fn_${Date.now()}`;
      const resultStr = JSON.stringify(result);

      const formats = [
        { type: 'tool-result', toolCallId: callId, result: resultStr },
        { type: 'add-message', message: { role: 'tool', tool_call_id: callId, content: resultStr } },
        { type: 'function-call-result', functionCallResult: { name: fnName, toolCallId: callId, result: resultStr } },
      ];

      for (const fmt of formats) {
        try { vapi.send(fmt); } catch {}
      }
    }
    return;
  }

  if (msg.type === 'transcript' && msg.transcriptType === 'final') {
    const icon = msg.role === 'assistant' ? '🗺️' : '🎙️';
    transcriptEl.innerHTML =
      `<span class="role">${icon}</span><span class="text">${escapeHtml(msg.transcript)}</span>`;
    transcriptEl.classList.add('visible');
  }
});

vapi.on('error', (err) => {
  console.error('[Vapi error]', err);
  setStatus('Error — check console', true);
});

function setStatus(text, visible) {
  voiceStatus.textContent = text;
  voiceStatus.classList.toggle('visible', !!visible && text.length > 0);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

if (VAPI_PUBLIC_KEY.startsWith('PASTE')) {
  console.warn('⚠️  Paste your Vapi Public Key + Assistant ID in voice.js to enable the voice agent.');
}
