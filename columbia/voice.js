/* ============================================================
   The Columbia Map — Voice + Data Integration
   Connects the page to your Vapi assistant via the Web SDK.
   Client-side function calling: tools below return live data
   the agent weaves into its spoken response.
   ============================================================ */

import Vapi from 'https://esm.sh/@vapi-ai/web@latest';

// =============================================================
// VAPI CREDENTIALS  ← paste yours here
// =============================================================
const VAPI_PUBLIC_KEY   = '046d7e78-64ab-404b-ad0e-e6c3e800bd41';
const VAPI_ASSISTANT_ID = 'eed4637f-c1f2-47f0-a896-f93c38532f1b';

// =============================================================
// Data caches — loaded once at startup
// =============================================================
let DATA = {
  tracts: null,
  places: null,
  summary: null,
  productivity: null,
  loaded: false,
};

async function loadData() {
  try {
    const [tracts, places, summary, productivity] = await Promise.all([
      fetch('data/columbia-area-tracts.geojson').then(r => r.json()),
      fetch('data/columbia-places.geojson').then(r => r.json()),
      fetch('data/columbia-area-summary.json').then(r => r.json()),
      fetch('productivity/citywide/summary.json').then(r => r.json()),
    ]);
    DATA.tracts = tracts;
    DATA.places = places;
    DATA.summary = summary;
    DATA.productivity = productivity;
    DATA.loaded = true;
    console.log(
      `📚 Voice agent data loaded: ${tracts.features.length} tracts, ` +
      `${places.features.length} places.`
    );
  } catch (err) {
    console.error('Could not load data for voice agent:', err);
  }
}
loadData();

// =============================================================
// TOOLS
// =============================================================
const TOOLS = {
  get_place_info({ name }) {
    if (!DATA.loaded) return { error: 'Data not loaded yet — try again in a moment.' };
    if (!name) return { error: 'Need a place name to look up.' };
    const n = String(name).toLowerCase().trim();

    // 1. County
    if (DATA.summary?.county_population_by_year) {
      for (const [county, years] of Object.entries(DATA.summary.county_population_by_year)) {
        if (n.includes(county.toLowerCase())) {
          return {
            name: `${county} County, SC`,
            type: 'county',
            population_by_year: years,
            growth_2010_2020_pct: DATA.summary.growth_pct_2010_2020,
            note: 'Richland County is home to Columbia, the state capital of South Carolina.',
          };
        }
      }
    }

    // 2. Places
    if (DATA.places?.features) {
      const place = DATA.places.features.find(f => {
        const dn = String(f.properties.display_name || '').toLowerCase();
        const bn = String(f.properties.BASENAME || '').toLowerCase();
        return dn.includes(n) || bn.includes(n) || n.includes(bn);
      });
      if (place) {
        return {
          name: place.properties.display_name,
          type: place.properties.kind,
          notes: place.properties.tooltip,
        };
      }
    }

    // 3. Tracts
    if (DATA.tracts?.features) {
      const digits = n.replace(/\D/g, '');
      const tract = DATA.tracts.features.find(f => {
        const t = String(f.properties.TRACT || '');
        const tn = String(f.properties.NAME || '').toLowerCase();
        return (digits && t.includes(digits)) || tn.includes(n);
      });
      if (tract) {
        const p = tract.properties;
        return {
          name: p.NAME,
          type: 'census_tract',
          county: `${p.county_name} County, SC`,
          population_2010: p.pop_2010,
          population_2020: p.pop_2020,
          growth_pct_2010_to_2020: p.growth_pct,
          note: p.has_2010 ? null : 'This tract did not exist in 2010 — it was split from a larger tract.',
        };
      }
    }

    return { error: `Couldn't find a place matching "${name}".` };
  },

  rank_tracts({ direction = 'fastest_growing', count = 5 }) {
    if (!DATA.loaded) return { error: 'Data not loaded yet.' };
    let pool = DATA.tracts.features.filter(f => f.properties.has_2010 === true);
    const sorters = {
      fastest_growing:    (a, b) => (b.properties.growth_pct ?? 0) - (a.properties.growth_pct ?? 0),
      declining:          (a, b) => (a.properties.growth_pct ?? 0) - (b.properties.growth_pct ?? 0),
      most_populous_2020: (a, b) => (b.properties.pop_2020 ?? 0) - (a.properties.pop_2020 ?? 0),
    };
    const sorter = sorters[direction];
    if (!sorter) return { error: `Unknown direction "${direction}".` };
    pool.sort(sorter);
    return {
      direction,
      tracts: pool.slice(0, count).map(f => ({
        name: f.properties.NAME,
        tract_id: f.properties.TRACT,
        population_2010: f.properties.pop_2010,
        population_2020: f.properties.pop_2020,
        growth_pct: f.properties.growth_pct,
      })),
    };
  },

  get_county_data({ year = null }) {
    if (!DATA.loaded) return { error: 'Data not loaded yet.' };
    const yearsByCounty = DATA.summary?.county_population_by_year || {};
    const result = {};
    for (const [k, data] of Object.entries(yearsByCounty)) {
      result[k] = year ? { [year]: data[year] } : data;
    }
    return { years: result, summary: { pop_2020: DATA.summary.pop_2020, pop_2010: DATA.summary.pop_2010, growth_pct: DATA.summary.growth_pct_2010_2020 } };
  },

  get_productivity_info({ area = 'all' }) {
    if (!DATA.loaded || !DATA.productivity) return { error: 'Productivity data not loaded yet.' };
    const areas = DATA.productivity.areas || {};
    const fmt = (v) => v != null ? Math.round(v).toLocaleString() : 'n/a';

    const keys = Object.keys(areas);
    const a = String(area).toLowerCase().trim();
    const matched = keys.find(k => k.toLowerCase().includes(a) || a.includes(k.toLowerCase()));

    if (matched) {
      const d = areas[matched];
      return {
        area: d.name || matched,
        description: d.description,
        parcels: d.n,
        acres: d.polygon_acres ? Math.round(d.polygon_acres).toLocaleString() : null,
        annual_tax: d.tax ? '$' + fmt(d.tax) : null,
        tax_per_acre: d.tpa ? '$' + fmt(d.tpa) + '/acre' : null,
        value_per_acre: d.vpa ? '$' + fmt(d.vpa) + '/acre' : null,
      };
    }

    return {
      comparison: keys.map(k => {
        const d = areas[k];
        return { area: k, tax_per_acre: d.tpa ? '$' + fmt(d.tpa) : 'n/a', annual_tax: d.tax ? '$' + fmt(d.tax) : 'n/a' };
      }),
    };
  },

  // Map control tools
  fly_to({ place, target, location }) {
    const p = place || target || location;
    return window.columbiaMap?.flyTo?.(p) ?? { error: 'Map control not initialized.' };
  },

  set_metric({ metric }) {
    return window.columbiaMap?.setMetric?.(metric) ?? { error: 'Map control not initialized.' };
  },

  scrub_year({ year }) {
    return window.columbiaMap?.setYear?.(year) ?? { error: 'Map control not initialized.' };
  },

  toggle_layer({ layer }) {
    return window.columbiaMap?.toggleLayer?.(layer) ?? { error: 'Map control not initialized.' };
  },

  reset_view() {
    return window.columbiaMap?.reset?.() ?? { error: 'Map control not initialized.' };
  },
};

// =============================================================
// Initialize Vapi + UI elements
// =============================================================
const vapi = new Vapi(VAPI_PUBLIC_KEY);

const voiceBtn     = document.getElementById('voiceBtn');
const voiceStatus  = document.getElementById('voiceStatus');
const transcriptEl = document.getElementById('transcript');
const btnLabel     = voiceBtn.querySelector('.label');

let callActive = false;

voiceBtn.addEventListener('click', () => {
  if (!callActive) {
    setStatus('Connecting…', true);
    vapi.start(VAPI_ASSISTANT_ID, {
      assistantOverrides: {
        firstMessage: 'Welcome to the Columbia Map. Ask me about any neighborhood, county, or census tract — or just say a place name and I\'ll fly you there.',
        model: {
          messages: [{
            role: 'system',
            content: 'You are a voice data guide for the Columbia, SC map on TownRing.com. Your tools contain census data for the Columbia metro area in Richland County. When discussing places or rankings, reference Columbia-area locations.',
          }],
        },
      },
    });
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
  hideTranscript();
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
    msg.toolCallList ||
    msg.tool_calls ||
    msg.toolCalls ||
    (msg.functionCall ? [{ id: msg.functionCall.id || `fn_${Date.now()}`, function: msg.functionCall }] : null) ||
    null;

  const isToolMessage = (
    msg.type === 'tool-calls' ||
    msg.type === 'function-call' ||
    msg.type === 'model-output' ||
    (toolCallList && toolCallList.length > 0)
  );

  if (isToolMessage && toolCallList && toolCallList.length > 0) {
    for (const call of toolCallList) {
      const fnName = call.function?.name || call.name;
      const rawArgs = call.function?.arguments ?? call.arguments ?? '{}';
      let args;
      try { args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs; }
      catch { args = {}; }

      const fn = TOOLS[fnName];
      let result;
      if (!fn) {
        result = { error: `Unknown function "${fnName}". Available: ${Object.keys(TOOLS).join(', ')}.` };
      } else {
        try { result = await fn(args || {}); }
        catch (e) { result = { error: String(e?.message || e) }; }
      }

      console.log(`🔧 [tool] ${fnName}(${JSON.stringify(args)}) →`, result);

      const callId = call.id || call.toolCallId || call.tool_call_id || `fn_${Date.now()}`;
      const resultString = JSON.stringify(result);

      const responseFormats = [
        { type: 'tool-result', toolCallId: callId, result: resultString },
        { type: 'add-message', message: { role: 'tool', tool_call_id: callId, content: resultString } },
        { type: 'function-call-result', functionCallResult: { name: fnName, toolCallId: callId, result: resultString } },
        { type: 'add-message', message: { role: 'system', content: `Tool ${fnName} returned: ${resultString}` } },
      ];

      for (const fmt of responseFormats) {
        try { vapi.send(fmt); } catch (e) {}
      }
    }
    return;
  }

  if (msg.type === 'transcript' && msg.transcriptType === 'final') {
    showTranscript(msg.role, msg.transcript);
  }
});

vapi.on('error', (err) => {
  console.error('[Vapi] error:', err);
  setStatus('Error — check console', true);
});

// =============================================================
// UI helpers
// =============================================================
function setStatus(text, visible) {
  voiceStatus.textContent = text;
  voiceStatus.classList.toggle('visible', !!visible && text.length > 0);
}

function showTranscript(role, text) {
  const icon = role === 'assistant' ? '🗺️' : '🎙️';
  transcriptEl.innerHTML =
    `<span class="role">${icon}</span><span class="text">${escapeHtml(text)}</span>`;
  transcriptEl.classList.add('visible');
}

function hideTranscript() {
  transcriptEl.classList.remove('visible');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

if (VAPI_PUBLIC_KEY.startsWith('PASTE') || VAPI_ASSISTANT_ID.startsWith('PASTE')) {
  console.warn('⚠️  Open voice.js and paste your Vapi Public Key + Assistant ID at the top.');
}

console.log('🎙️  Columbia voice agent ready. Click "Talk to the Map" to start.');
