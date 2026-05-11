/* ============================================================
   The Chapin Map — Voice + Data Integration
   ============================================================
   Connects the page to your Vapi assistant via the Web SDK.
   This version adds CLIENT-SIDE FUNCTION CALLING — when the
   agent asks a question that requires real data, it calls one
   of the tools below and weaves the answer into its response.
   ============================================================ */

import Vapi from 'https://esm.sh/@vapi-ai/web@latest';

// =============================================================
// VAPI CREDENTIALS  ← only place you edit
// =============================================================
const VAPI_PUBLIC_KEY    = '046d7e78-64ab-404b-ad0e-e6c3e800bd41';
const VAPI_ASSISTANT_ID  = 'ac689a99-081e-4f4e-8d80-746e6d7daa6a';

// =============================================================
// Data caches — loaded once at startup so tool calls are instant
// =============================================================
let DATA = {
  tracts: null,         // chapin-area-tracts.geojson
  places: null,         // chapin-places.geojson
  summary: null,        // chapin-area-summary.json
  loaded: false,
};

async function loadData() {
  try {
    const [tracts, places, summary] = await Promise.all([
      fetch('data/chapin-area-tracts.geojson').then(r => r.json()),
      fetch('data/chapin-places.geojson').then(r => r.json()),
      fetch('data/chapin-area-summary.json').then(r => r.json()),
    ]);
    DATA.tracts = tracts;
    DATA.places = places;
    DATA.summary = summary;
    DATA.loaded = true;
    console.log(
      `📚 Voice agent data loaded: ${tracts.features.length} tracts, ` +
      `${places.features.length} places, ${Object.keys(summary.county_population_by_year || {}).length} counties.`
    );
  } catch (err) {
    console.error('Could not load data for voice agent:', err);
  }
}
loadData();

// =============================================================
// TOOLS — these are what the voice agent calls
// -------------------------------------------------------------
// Each tool is a pure function that takes structured args and
// returns a JSON result the LLM weaves into its response.
// =============================================================
const TOOLS = {
  /**
   * Look up info about any named place — town, CDP, ZIP, county, tract.
   * Returns whatever data we have for it.
   */
  get_place_info({ name }) {
    if (!DATA.loaded) return { error: 'Data not loaded yet — try again in a moment.' };
    if (!name) return { error: 'Need a place name to look up.' };

    const n = String(name).toLowerCase().trim();

    // 1. Counties
    if (DATA.summary?.county_population_by_year) {
      for (const [county, years] of Object.entries(DATA.summary.county_population_by_year)) {
        if (n.includes(county.toLowerCase())) {
          return {
            name: `${county} County, SC`,
            type: 'county',
            population_by_year: years,
            growth_2000_2020_pct: years[2000] && years[2020]
              ? Math.round((years[2020] - years[2000]) / years[2000] * 1000) / 10
              : null,
            note: county === 'Lexington'
              ? 'Most of Chapin proper is in Lexington County.'
              : 'White Rock and the eastern Greater Chapin area are in Richland County.',
          };
        }
      }
    }

    // 2. Places (towns, CDPs, ZIP, colloquial)
    if (DATA.places?.features) {
      const place = DATA.places.features.find(f => {
        const dn = String(f.properties.display_name || '').toLowerCase();
        const bn = String(f.properties.BASENAME || '').toLowerCase();
        return dn.includes(n) || bn.includes(n) || n.includes(bn) || (bn && n.includes(bn));
      });
      if (place) {
        return {
          name: place.properties.display_name,
          type: place.properties.kind,
          county_fips: place.properties.STATE && place.properties.COUNTY
            ? `${place.properties.STATE}${place.properties.COUNTY}` : null,
          notes: place.properties.tooltip,
        };
      }
    }

    // 3. Tracts by tract number (e.g. "210.19" or "021019")
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
          note: p.has_2010
            ? null
            : 'This tract did not exist in 2010 — it was created when an older tract was split (often a fast-growth area).',
        };
      }
    }

    return { error: `Couldn't find a place matching "${name}".` };
  },

  /**
   * Find tracts by extreme metric — fastest growing, declining, most populous, etc.
   * direction: 'fastest_growing' | 'declining' | 'most_populous_2020'
   */
  rank_tracts({ direction = 'fastest_growing', count = 5, county = null }) {
    if (!DATA.loaded) return { error: 'Data not loaded yet.' };

    let pool = DATA.tracts.features.filter(f => f.properties.has_2010 === true);
    if (county) {
      const cn = String(county).toLowerCase();
      pool = pool.filter(f => String(f.properties.county_name || '').toLowerCase().includes(cn));
    }

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
      count: Math.min(count, pool.length),
      tracts: pool.slice(0, count).map(f => ({
        name: f.properties.NAME,
        tract_id: f.properties.TRACT,
        county: f.properties.county_name,
        population_2010: f.properties.pop_2010,
        population_2020: f.properties.pop_2020,
        growth_pct: f.properties.growth_pct,
      })),
    };
  },

  /**
   * County-level data with optional year filter.
   * county: 'Lexington' | 'Richland' | 'both'
   */
  get_county_data({ county = 'both', year = null }) {
    if (!DATA.loaded) return { error: 'Data not loaded yet.' };
    const yearsByCounty = DATA.summary?.county_population_by_year || {};

    const result = {};
    const keys = county === 'both' ? Object.keys(yearsByCounty) : [county];
    for (const k of keys) {
      const matched = Object.keys(yearsByCounty).find(
        c => c.toLowerCase().includes(String(k).toLowerCase())
      );
      if (!matched) continue;
      const data = yearsByCounty[matched];
      result[matched] = year ? { [year]: data[year] } : data;
    }
    return Object.keys(result).length === 0
      ? { error: `No data for county "${county}".` }
      : { years: result };
  },

  // ============================================================
  // CLIENT-SIDE MAP CONTROL TOOLS (Session 9)
  // ------------------------------------------------------------
  // These don't have a Server URL in Vapi. Vapi sends the call
  // to the client, we execute on the map, return a confirmation.
  // Voice agent says "flying you to White Rock" while the map flies.
  // ============================================================
  fly_to({ place, target, location }) {
    const p = place || target || location;
    return window.chapinMap?.flyTo?.(p) ?? { error: 'Map control not initialized.' };
  },

  set_metric({ metric }) {
    return window.chapinMap?.setMetric?.(metric) ?? { error: 'Map control not initialized.' };
  },

  scrub_year({ year }) {
    return window.chapinMap?.setYear?.(year) ?? { error: 'Map control not initialized.' };
  },

  toggle_layer({ layer }) {
    return window.chapinMap?.toggleLayer?.(layer) ?? { error: 'Map control not initialized.' };
  },

  reset_view() {
    return window.chapinMap?.reset?.() ?? { error: 'Map control not initialized.' };
  },
};

// =============================================================
// Initialize Vapi + grab UI elements
// =============================================================
const vapi = new Vapi(VAPI_PUBLIC_KEY);

const voiceBtn     = document.getElementById('voiceBtn');
const voiceStatus  = document.getElementById('voiceStatus');
const transcriptEl = document.getElementById('transcript');
const btnLabel     = voiceBtn.querySelector('.label');

let callActive = false;

// =============================================================
// Click handler — start / stop call
// =============================================================
voiceBtn.addEventListener('click', () => {
  if (!callActive) {
    setStatus('Connecting…', true);
    vapi.start(VAPI_ASSISTANT_ID);
  } else {
    vapi.stop();
  }
});

// =============================================================
// Vapi event handlers
// =============================================================
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

// =============================================================
// THE NEW PART — handle tool calls + transcript messages
// -------------------------------------------------------------
// Vapi's tool-call response format has evolved. We log every
// incoming message + try multiple response formats so something
// works regardless of which Vapi version is on the other end.
// =============================================================
vapi.on('message', async (msg) => {
  // DEBUG: log every message for diagnosis (you can comment this out later)
  if (msg.type !== 'transcript' && msg.type !== 'speech-update' && msg.type !== 'voice-input') {
    console.log('[Vapi msg]', msg.type, msg);
  }

  // Tool calls — handle the various shapes Vapi might use
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
        try {
          result = await fn(args || {});
        } catch (e) {
          result = { error: String(e?.message || e) };
        }
      }

      console.log(`🔧 [tool] ${fnName}(${JSON.stringify(args)}) →`, result);

      const callId = call.id || call.toolCallId || call.tool_call_id || `fn_${Date.now()}`;
      const resultString = JSON.stringify(result);

      // Try multiple response shapes — Vapi accepts whichever it understands.
      const responseFormats = [
        // Newer Vapi (preferred)
        {
          type: 'tool-result',
          toolCallId: callId,
          result: resultString,
        },
        // OpenAI-style add-message (older Vapi)
        {
          type: 'add-message',
          message: {
            role: 'tool',
            tool_call_id: callId,
            content: resultString,
          },
        },
        // Function-call-result (alternate)
        {
          type: 'function-call-result',
          functionCallResult: {
            name: fnName,
            toolCallId: callId,
            result: resultString,
          },
        },
        // Plain say-it-back (last resort — agent will speak the JSON)
        {
          type: 'add-message',
          message: {
            role: 'system',
            content: `Tool ${fnName} returned: ${resultString}`,
          },
        },
      ];

      for (const fmt of responseFormats) {
        try {
          vapi.send(fmt);
          console.log(`  ↳ sent response format: ${fmt.type}`);
        } catch (e) {
          console.log(`  ↳ format ${fmt.type} failed:`, e?.message || e);
        }
      }
    }
    return;
  }

  // Transcripts (existing behavior)
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
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// Startup nudge if keys haven't been pasted yet
if (VAPI_PUBLIC_KEY.startsWith('PASTE') || VAPI_ASSISTANT_ID.startsWith('PASTE')) {
  console.warn('⚠️  Open voice.js and paste your Vapi Public Key + Assistant ID at the top.');
}

console.log('🎙️  Voice agent ready. Click "Talk to the Map" to start.');
