/* ============================================================
   The Chapin Map — Sessions 1-6
   Mapbox 3D map of Chapin SC + Greater Chapin area, with:
     - Census tract choropleth (switchable across 5 metrics)
     - Place boundaries (Chapin, Irmo, Lake Murray of Richland, ZIP 29036)
     - Colloquial place markers (Ballentine, White Rock)
     - Voice agent integration (handled in voice.js)
   ============================================================ */

// =============================================================
// 1. MAPBOX TOKEN
// =============================================================
mapboxgl.accessToken = 'pk.eyJ1IjoiamltbXlhcmRpcyIsImEiOiJjbW93d3EzOGowaHBiMnJvZngweWIxZXN6In0.DGI7a-dUV1fphfE4uP-HwQ';

// =============================================================
// 2. CHAPIN, SOUTH CAROLINA
// =============================================================
const CHAPIN_CENTER = [-81.3528, 34.1654];
const DEFAULT_ZOOM = 11;
const DEFAULT_PITCH = 35;
const DEFAULT_BEARING = 0;

// =============================================================
// 3. LANDMARKS
// =============================================================
const LANDMARKS = [
  { name: 'Chapin Town Hall',    coordinates: [-81.3527, 34.1654], description: 'Heart of downtown Chapin.' },
  { name: 'Chapin High School',  coordinates: [-81.3478, 34.1611], description: 'Home of the Eagles.' },
  { name: 'Crooked Creek Park',  coordinates: [-81.3484, 34.1789], description: 'Local recreation hub on the north side.' },
  { name: 'Lake Murray Dam',     coordinates: [-81.2128, 34.0523], description: 'Saluda Hydroelectric Dam at the south end of Lake Murray.' },
];

// =============================================================
// 4. DATA LAYER PATHS
// =============================================================
const CENSUS_GEOJSON_PATH    = 'data/chapin-area-tracts.geojson';
const PLACES_GEOJSON_PATH    = 'data/chapin-places.geojson';
const CINEMATIC_SHAPES_PATH  = 'data/chapin-cinematic-shapes.geojson';

// Bounding box of the Greater Chapin union (computed in compute-chapin-union.py)
const GREATER_CHAPIN_BOUNDS = [
  [-81.437, 34.063],  // SW corner [lng, lat]
  [-81.147, 34.239],  // NE corner
];

// =============================================================
// 5. METRICS — each one defines its own choropleth + legend
// -------------------------------------------------------------
// Add a new metric here and it shows up in the dropdown automatically.
// =============================================================
const METRICS = {
  growth_pct: {
    label: 'Population growth, 2010 → 2020',
    property: 'growth_pct',
    nullCheck: ['==', ['get', 'has_2010'], false],
    nullColor: 'rgba(180, 180, 180, 0.55)',
    nullLabel: 'New tract since 2010 (boundary changed)',
    stops: [
      [-15, '#4a4a4a'],
      [ -5, '#888888'],
      [  0, '#f3e8d6'],
      [ 10, '#9bb8d3'],
      [ 25, '#3d6fa3'],
      [ 50, '#1a4d8f'],
      [ 85, '#0a2845'],
    ],
    legendLabels: ['−15%', '0%', '+25%', '+85%'],
    formatPopup: v => v == null ? 'n/a' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`,
  },

  density_per_sqkm: {
    label: 'Population density',
    property: 'density_per_sqkm',
    nullCheck: ['==', ['get', 'density_per_sqkm'], null],
    nullColor: 'rgba(180, 180, 180, 0.55)',
    nullLabel: 'No data',
    stops: [
      [   0, '#f7fbff'],
      [ 100, '#deebf7'],
      [ 500, '#9ecae1'],
      [1500, '#4292c6'],
      [3000, '#2171b5'],
      [6000, '#08306b'],
    ],
    legendLabels: ['0', '500', '1.5k', '6k+ /km²'],
    formatPopup: v => v == null ? 'n/a' : `${Math.round(v).toLocaleString()} /km²`,
  },

  median_income: {
    label: 'Median household income',
    property: 'median_income',
    nullCheck: ['==', ['get', 'median_income'], null],
    nullColor: 'rgba(180, 180, 180, 0.55)',
    nullLabel: 'No data',
    stops: [
      [ 25000, '#ffffe5'],
      [ 50000, '#d9f0a3'],
      [ 75000, '#78c679'],
      [100000, '#41ab5d'],
      [150000, '#005a32'],
    ],
    legendLabels: ['$25k', '$50k', '$100k', '$150k+'],
    formatPopup: v => v == null ? 'n/a' : `$${v.toLocaleString()}`,
  },

  median_age: {
    label: 'Median age',
    property: 'median_age',
    nullCheck: ['==', ['get', 'median_age'], null],
    nullColor: 'rgba(180, 180, 180, 0.55)',
    nullLabel: 'No data',
    stops: [
      [20, '#fff5eb'],
      [30, '#fdd0a2'],
      [40, '#fd8d3c'],
      [50, '#d94801'],
      [60, '#7f2704'],
    ],
    legendLabels: ['20', '30', '40', '60+'],
    formatPopup: v => v == null ? 'n/a' : `${v.toFixed(1)} yrs`,
  },

  pct_nonwhite: {
    label: 'Racial composition (% non-white)',
    property: 'pct_nonwhite',
    nullCheck: ['==', ['get', 'pct_nonwhite'], null],
    nullColor: 'rgba(180, 180, 180, 0.55)',
    nullLabel: 'No data',
    stops: [
      [  0, '#fcfbfd'],
      [ 25, '#dadaeb'],
      [ 50, '#9e9ac8'],
      [ 75, '#6a51a3'],
      [100, '#3f007d'],
    ],
    legendLabels: ['0%', '25%', '50%', '100%'],
    formatPopup: v => v == null ? 'n/a' : `${v.toFixed(0)}%`,
  },

  // Year-aware metric: choropleth recolors as the time slider scrubs
  population_by_year: {
    label: 'Population (drag time slider)',
    isYearAware: true,
    years: [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022],
    defaultYear: 2022,
    propertyTemplate: 'pop_{year}',
    nullColor: 'rgba(180, 180, 180, 0.55)',
    nullLabel: 'No data for this year',
    stops: [
      [   0, '#fff5eb'],
      [1000, '#fdd0a2'],
      [3000, '#fd8d3c'],
      [5000, '#d94801'],
      [8000, '#7f2704'],
    ],
    legendLabels: ['0', '1k', '3k', '5k+'],
    formatPopup: v => v == null ? 'no data' : Number(v).toLocaleString(),
  },
};

const DEFAULT_METRIC = 'growth_pct';
let currentMetric = DEFAULT_METRIC;
let currentYear = null;  // null when current metric isn't year-aware

function getActiveProperty(metricKey, year = null) {
  const m = METRICS[metricKey];
  if (m.isYearAware && year != null) return m.propertyTemplate.replace('{year}', year);
  return m.property;
}

function buildFillColorExpression(metricKey, year = null) {
  const m = METRICS[metricKey];
  const property = getActiveProperty(metricKey, year);
  const interpolation = ['interpolate', ['linear'], ['coalesce', ['get', property], 0]];
  for (const [stop, color] of m.stops) interpolation.push(stop, color);
  const nullCheck = m.isYearAware
    ? ['==', ['get', property], null]
    : m.nullCheck;
  return ['case', nullCheck, m.nullColor, interpolation];
}

function gradientCss(metricKey) {
  const m = METRICS[metricKey];
  const segments = m.stops.map(([_, color], i) => {
    const pct = (i / (m.stops.length - 1)) * 100;
    return `${color} ${pct}%`;
  });
  return `linear-gradient(to right, ${segments.join(', ')})`;
}

function updateLegend(metricKey) {
  const m = METRICS[metricKey];
  const titleEl   = document.querySelector('.legend-title');
  const gradEl    = document.querySelector('.legend-gradient');
  const labelsEl  = document.querySelector('.legend-labels');
  const nullDescr = document.querySelector('.legend-null-label');

  if (titleEl)  titleEl.textContent = m.label;
  if (gradEl)   gradEl.style.background = gradientCss(metricKey);
  if (labelsEl) labelsEl.innerHTML = m.legendLabels.map(l => `<span>${l}</span>`).join('');
  if (nullDescr) nullDescr.textContent = m.nullLabel;
}

function setMetric(metricKey) {
  if (!METRICS[metricKey]) return;
  currentMetric = metricKey;
  const m = METRICS[metricKey];

  if (m.isYearAware) {
    if (currentYear == null || !m.years.includes(currentYear)) {
      currentYear = m.defaultYear;
    }
    showTimeSlider(m, currentYear);
  } else {
    currentYear = null;
    hideTimeSlider();
  }

  if (map.getLayer('census-fill')) {
    map.setPaintProperty(
      'census-fill',
      'fill-color',
      buildFillColorExpression(metricKey, currentYear)
    );
  }
  updateLegend(metricKey);
}

function showTimeSlider(metric, year) {
  const slider = document.getElementById('timeSlider');
  if (!slider) return;
  const range = slider.querySelector('#yearRange');
  const yearLabel = slider.querySelector('.time-slider-year');
  const boundsEls = slider.querySelectorAll('.time-slider-bounds span');

  if (range) {
    range.min = metric.years[0];
    range.max = metric.years[metric.years.length - 1];
    range.step = 1;
    range.value = year;
  }
  if (yearLabel) yearLabel.textContent = year;
  if (boundsEls.length >= 2) {
    boundsEls[0].textContent = metric.years[0];
    boundsEls[1].textContent = metric.years[metric.years.length - 1];
  }
  slider.classList.remove('hidden');
}

function hideTimeSlider() {
  document.getElementById('timeSlider')?.classList.add('hidden');
}

// =============================================================
// 6. INITIALIZE THE MAP
// =============================================================
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/standard',
  center: CHAPIN_CENTER,
  zoom: DEFAULT_ZOOM,
  pitch: DEFAULT_PITCH,
  bearing: DEFAULT_BEARING,
  antialias: true,
});

map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'bottom-right');

// =============================================================
// 7. ON LOAD
// =============================================================
map.on('load', async () => {
  // -------- 7a. Lighting preset --------
  try { map.setConfigProperty('basemap', 'lightPreset', 'day'); } catch (e) {}

  // -------- 7b. Census choropleth --------
  try {
    map.addSource('chapin-area-tracts', {
      type: 'geojson',
      data: CENSUS_GEOJSON_PATH,
      promoteId: 'GEOID',
    });

    map.addLayer({
      id: 'census-fill',
      type: 'fill',
      source: 'chapin-area-tracts',
      slot: 'bottom',
      paint: {
        'fill-color': buildFillColorExpression(DEFAULT_METRIC),
        'fill-opacity': [
          'case',
          ['boolean', ['feature-state', 'hover'], false], 0.85,
          0.65,
        ],
      },
    });

    map.addLayer({
      id: 'census-outline',
      type: 'line',
      source: 'chapin-area-tracts',
      slot: 'middle',
      paint: {
        'line-color': 'rgba(255, 255, 255, 0.7)',
        'line-width': [
          'case',
          ['boolean', ['feature-state', 'hover'], false], 2.5,
          0.6,
        ],
      },
    });

    console.log('🏘️  Census layer loaded.');
  } catch (err) {
    console.error('Census layer failed:', err);
  }

  // -------- 7c. Place boundaries --------
  try {
    map.addSource('chapin-places', { type: 'geojson', data: PLACES_GEOJSON_PATH });

    map.addLayer({
      id: 'zip-fill',
      type: 'fill',
      source: 'chapin-places',
      filter: ['==', ['get', 'kind'], 'zip'],
      slot: 'middle',
      paint: { 'fill-color': '#c9a55a', 'fill-opacity': 0.07 },
    });

    map.addLayer({
      id: 'zip-outline',
      type: 'line',
      source: 'chapin-places',
      filter: ['==', ['get', 'kind'], 'zip'],
      slot: 'top',
      paint: { 'line-color': '#c9a55a', 'line-width': 2, 'line-dasharray': [3, 2] },
    });

    map.addLayer({
      id: 'place-outline',
      type: 'line',
      source: 'chapin-places',
      filter: ['any',
        ['==', ['get', 'kind'], 'incorporated_town'],
        ['==', ['get', 'kind'], 'cdp'],
      ],
      slot: 'top',
      paint: { 'line-color': '#a07d2e', 'line-width': 2.4 },
    });

    map.addLayer({
      id: 'colloquial-points',
      type: 'circle',
      source: 'chapin-places',
      filter: ['==', ['get', 'kind'], 'colloquial'],
      slot: 'top',
      paint: {
        'circle-radius': 7,
        'circle-color': '#c9a55a',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
      },
    });

    map.addLayer({
      id: 'place-labels',
      type: 'symbol',
      source: 'chapin-places',
      filter: ['!=', ['get', 'kind'], 'zip'],
      slot: 'top',
      layout: {
        'text-field': ['get', 'display_name'],
        'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10, 14, 14],
        'text-offset': [0, 1.0],
        'text-anchor': 'top',
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': '#5a4015',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.6,
      },
    });

    console.log('🏛️  Place boundaries loaded.');
  } catch (err) {
    console.error('Place layer failed:', err);
  }

  // -------- 7d. Cinematic clip shapes (inverted mask + Greater Chapin glow) --------
  try {
    map.addSource('chapin-cinematic', {
      type: 'geojson',
      data: CINEMATIC_SHAPES_PATH,
    });

    // Inverted mask — covers everything OUTSIDE Greater Chapin in dark space
    map.addLayer({
      id: 'cinematic-mask',
      type: 'fill',
      source: 'chapin-cinematic',
      filter: ['==', ['get', 'kind'], 'inverted_mask'],
      slot: 'top',
      layout: { visibility: 'none' },
      paint: {
        'fill-color': '#05050a',
        'fill-opacity': 0.96,
      },
    });

    // Greater Chapin glow border — warm gold edge so the area "lights up"
    map.addLayer({
      id: 'cinematic-glow',
      type: 'line',
      source: 'chapin-cinematic',
      filter: ['==', ['get', 'kind'], 'greater_chapin_union'],
      slot: 'top',
      layout: { visibility: 'none' },
      paint: {
        'line-color': '#e8c87a',
        'line-width': 3,
        'line-blur': 2,
        'line-opacity': 0.9,
      },
    });

    console.log('✦  Cinematic clip shapes loaded.');
  } catch (err) {
    console.error('Cinematic shapes failed:', err);
  }

  // -------- 7e. Landmark pins --------
  LANDMARKS.forEach((landmark) => {
    const popup = new mapboxgl.Popup({ offset: 25, closeButton: false }).setHTML(`
      <div class="marker-popup">
        <h3>${landmark.name}</h3>
        <p>${landmark.description}</p>
      </div>`);
    new mapboxgl.Marker({ color: '#c1392b' })
      .setLngLat(landmark.coordinates).setPopup(popup).addTo(map);
  });

  console.log('🗺️  Chapin map loaded — Session 6 (Demographics).');
});

// =============================================================
// 8. CENSUS TRACT INTERACTION
// =============================================================
let hoveredTractId = null;

map.on('mousemove', 'census-fill', (e) => {
  if (e.features.length === 0) return;
  map.getCanvas().style.cursor = 'pointer';
  const newId = e.features[0].id;
  if (hoveredTractId !== null && hoveredTractId !== newId) {
    map.setFeatureState({ source: 'chapin-area-tracts', id: hoveredTractId }, { hover: false });
  }
  hoveredTractId = newId;
  map.setFeatureState({ source: 'chapin-area-tracts', id: hoveredTractId }, { hover: true });
});

map.on('mouseleave', 'census-fill', () => {
  map.getCanvas().style.cursor = '';
  if (hoveredTractId !== null) {
    map.setFeatureState({ source: 'chapin-area-tracts', id: hoveredTractId }, { hover: false });
  }
  hoveredTractId = null;
});

map.on('click', 'census-fill', (e) => {
  if (e.features.length === 0) return;
  const p = e.features[0].properties;
  const name = p.NAME || `Tract ${p.TRACT}`;
  const countyTag = p.county_name ? `<div class="tract-county">${p.county_name} County, SC${p.is_greater_chapin === true || p.is_greater_chapin === 'true' ? ' &middot; <span class="ga-tag">Greater Chapin</span>' : ''}</div>` : '';

  const fmt = (key) => {
    const m = METRICS[key];
    if (!m) return 'n/a';
    const raw = p[m.property];
    return m.formatPopup(raw == null ? null : (typeof raw === 'string' && /^-?\d+(\.\d+)?$/.test(raw) ? parseFloat(raw) : raw));
  };

  const stat = (label, value) => `<div class="tract-stat"><span class="label">${label}</span><span class="value">${value}</span></div>`;

  const body = `
    <div class="tract-popup">
      <h3>${name}</h3>
      ${countyTag}
      <div class="tract-stat-grid">
        ${stat('Pop 2020', p.pop_2020 != null ? Number(p.pop_2020).toLocaleString() : 'n/a')}
        ${stat('Growth', fmt('growth_pct'))}
        ${stat('Density', fmt('density_per_sqkm'))}
        ${stat('Median income', fmt('median_income'))}
        ${stat('Median age', fmt('median_age'))}
        ${stat('% Non-white', fmt('pct_nonwhite'))}
      </div>
    </div>`;

  new mapboxgl.Popup({ offset: 4, maxWidth: '300px' }).setLngLat(e.lngLat).setHTML(body).addTo(map);
});

// =============================================================
// 9. PLACES INTERACTION
// =============================================================
['zip-fill', 'place-outline', 'colloquial-points'].forEach((layerId) => {
  map.on('click', layerId, (e) => {
    if (e.features.length === 0) return;
    const p = e.features[0].properties;
    new mapboxgl.Popup({ offset: 8, maxWidth: '280px' })
      .setLngLat(e.lngLat)
      .setHTML(`<div class="place-popup"><h3>${p.display_name}</h3><p>${p.tooltip || ''}</p></div>`)
      .addTo(map);
    e.originalEvent.stopPropagation();
  });
  map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
});

// =============================================================
// 10. CONTROLS
// =============================================================
document.getElementById('resetView').addEventListener('click', () => {
  map.flyTo({ center: CHAPIN_CENTER, zoom: DEFAULT_ZOOM, pitch: DEFAULT_PITCH, bearing: DEFAULT_BEARING, duration: 1800, essential: true });
});

let in3DMode = true;
document.getElementById('toggle3D').addEventListener('click', (e) => {
  in3DMode = !in3DMode;
  map.easeTo({ pitch: in3DMode ? DEFAULT_PITCH : 0, bearing: in3DMode ? DEFAULT_BEARING : 0, duration: 1200 });
  e.target.textContent = in3DMode ? 'Toggle 3D' : 'Toggle 2D';
});

const LIGHT_PRESETS = ['day', 'dusk', 'dawn', 'night'];
let lightIndex = 0;
document.getElementById('cycleLight').addEventListener('click', (e) => {
  lightIndex = (lightIndex + 1) % LIGHT_PRESETS.length;
  const preset = LIGHT_PRESETS[lightIndex];
  try { map.setConfigProperty('basemap', 'lightPreset', preset); e.target.textContent = `Lighting: ${preset}`; }
  catch (err) {}
});

// =============================================================
// 11. STYLE CYCLE — Standard / Satellite / Dark
// =============================================================
const STYLES = [
  { id: 'mapbox://styles/mapbox/standard',          label: 'standard'  },
  { id: 'mapbox://styles/mapbox/satellite-streets-v12', label: 'satellite' },
  { id: 'mapbox://styles/mapbox/dark-v11',          label: 'dark'      },
];
let styleIndex = 0;
const cycleStyleBtn = document.getElementById('cycleStyle');
if (cycleStyleBtn) {
  cycleStyleBtn.addEventListener('click', (e) => {
    styleIndex = (styleIndex + 1) % STYLES.length;
    const next = STYLES[styleIndex];
    e.target.textContent = `Style: ${next.label}`;
    map.setStyle(next.id);
    // Re-add data layers after style swap (Mapbox clears them)
    map.once('style.load', () => {
      try { map.setConfigProperty('basemap', 'lightPreset', LIGHT_PRESETS[lightIndex]); } catch (err) {}
      reAddDataLayers();
    });
  });
}

// =============================================================
// 12. CINEMATIC MODE — Greater Chapin floating in space
// -------------------------------------------------------------
// Toggling ON:
//   - Inverted mask covers everything OUTSIDE Greater Chapin
//   - Gold glow border lights up the Greater Chapin shape
//   - Map fits the Greater Chapin bounding box
//   - Globe projection + space fog + stars for the surrounding void
//   - UI dims so the map is the focal point
// All data layers (choropleth, time slider, places) keep working
// inside the Greater Chapin shape.
// =============================================================
let cinematicMode = false;
const cinematicBtn = document.getElementById('toggleCinematic');
if (cinematicBtn) {
  cinematicBtn.addEventListener('click', (e) => {
    cinematicMode = !cinematicMode;
    document.body.classList.toggle('cinematic', cinematicMode);

    if (cinematicMode) {
      // 1. Show the clip layers (mask + glow border)
      if (map.getLayer('cinematic-mask'))  map.setLayoutProperty('cinematic-mask',  'visibility', 'visible');
      if (map.getLayer('cinematic-glow'))  map.setLayoutProperty('cinematic-glow',  'visibility', 'visible');

      // 2. Hide basemap labels — POIs, road names, highway shields, place names —
      //    so the masked-out area is pure dark space without sign clutter
      try { map.setConfigProperty('basemap', 'showPointOfInterestLabels', false); } catch (err) {}
      try { map.setConfigProperty('basemap', 'showPlaceLabels',           false); } catch (err) {}
      try { map.setConfigProperty('basemap', 'showRoadLabels',            false); } catch (err) {}
      try { map.setConfigProperty('basemap', 'showTransitLabels',         false); } catch (err) {}

      // 3. Globe projection + space fog + stars
      try { map.setProjection('globe'); } catch (err) {}
      try {
        map.setFog({
          'color':            'rgba(8, 8, 12, 1)',
          'high-color':       '#0a0a14',
          'space-color':      '#000000',
          'horizon-blend':    0.04,
          'star-intensity':   1.0,
        });
      } catch (err) {}

      // 4. Fly to fit Greater Chapin in viewport with dramatic tilt
      map.fitBounds(GREATER_CHAPIN_BOUNDS, {
        padding: { top: 80, bottom: 120, left: 80, right: 80 },
        pitch: 55,
        bearing: -15,
        duration: 2400,
        essential: true,
      });

      e.target.textContent = '✦ Exit cinematic';
    } else {
      // Hide the clip layers
      if (map.getLayer('cinematic-mask')) map.setLayoutProperty('cinematic-mask', 'visibility', 'none');
      if (map.getLayer('cinematic-glow')) map.setLayoutProperty('cinematic-glow', 'visibility', 'none');

      // Restore basemap labels
      try { map.setConfigProperty('basemap', 'showPointOfInterestLabels', true); } catch (err) {}
      try { map.setConfigProperty('basemap', 'showPlaceLabels',           true); } catch (err) {}
      try { map.setConfigProperty('basemap', 'showRoadLabels',            true); } catch (err) {}
      try { map.setConfigProperty('basemap', 'showTransitLabels',         true); } catch (err) {}

      // Reset projection + fog
      try { map.setProjection('mercator'); } catch (err) {}
      try { map.setFog(null); } catch (err) {}

      // Reset view
      map.easeTo({
        center: CHAPIN_CENTER,
        zoom: DEFAULT_ZOOM,
        pitch: DEFAULT_PITCH,
        bearing: DEFAULT_BEARING,
        duration: 1800,
        essential: true,
      });

      e.target.textContent = '✦ Cinematic';
    }
  });
}

// Helper to re-add Census + place layers after a style swap
function reAddDataLayers() {
  // Re-add Census source + layers
  if (!map.getSource('chapin-area-tracts')) {
    try {
      map.addSource('chapin-area-tracts', {
        type: 'geojson',
        data: CENSUS_GEOJSON_PATH,
        promoteId: 'GEOID',
      });
      map.addLayer({
        id: 'census-fill',
        type: 'fill',
        source: 'chapin-area-tracts',
        slot: 'bottom',
        paint: {
          'fill-color': buildFillColorExpression(currentMetric, currentYear),
          'fill-opacity': [
            'case',
            ['boolean', ['feature-state', 'hover'], false], 0.85,
            0.65,
          ],
        },
      });
      map.addLayer({
        id: 'census-outline',
        type: 'line',
        source: 'chapin-area-tracts',
        slot: 'middle',
        paint: {
          'line-color': 'rgba(255, 255, 255, 0.7)',
          'line-width': [
            'case',
            ['boolean', ['feature-state', 'hover'], false], 2.5,
            0.6,
          ],
        },
      });
    } catch (err) { console.error('Re-add Census failed:', err); }
  }

  // Re-add places source + layers
  if (!map.getSource('chapin-places')) {
    try {
      map.addSource('chapin-places', { type: 'geojson', data: PLACES_GEOJSON_PATH });
      map.addLayer({
        id: 'zip-fill', type: 'fill', source: 'chapin-places',
        filter: ['==', ['get', 'kind'], 'zip'], slot: 'middle',
        paint: { 'fill-color': '#c9a55a', 'fill-opacity': 0.07 },
      });
      map.addLayer({
        id: 'zip-outline', type: 'line', source: 'chapin-places',
        filter: ['==', ['get', 'kind'], 'zip'], slot: 'top',
        paint: { 'line-color': '#c9a55a', 'line-width': 2, 'line-dasharray': [3, 2] },
      });
      map.addLayer({
        id: 'place-outline', type: 'line', source: 'chapin-places',
        filter: ['any', ['==', ['get', 'kind'], 'incorporated_town'], ['==', ['get', 'kind'], 'cdp']],
        slot: 'top',
        paint: { 'line-color': '#a07d2e', 'line-width': 2.4 },
      });
      map.addLayer({
        id: 'colloquial-points', type: 'circle', source: 'chapin-places',
        filter: ['==', ['get', 'kind'], 'colloquial'], slot: 'top',
        paint: { 'circle-radius': 7, 'circle-color': '#c9a55a', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 },
      });
      map.addLayer({
        id: 'place-labels', type: 'symbol', source: 'chapin-places',
        filter: ['!=', ['get', 'kind'], 'zip'], slot: 'top',
        layout: {
          'text-field': ['get', 'display_name'],
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10, 14, 14],
          'text-offset': [0, 1.0], 'text-anchor': 'top', 'text-allow-overlap': false,
        },
        paint: { 'text-color': '#5a4015', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 },
      });
    } catch (err) { console.error('Re-add places failed:', err); }
  }
}

let placesVisible = true;
const placesBtn = document.getElementById('togglePlaces');
if (placesBtn) {
  placesBtn.addEventListener('click', (e) => {
    placesVisible = !placesVisible;
    const visibility = placesVisible ? 'visible' : 'none';
    ['zip-fill', 'zip-outline', 'place-outline', 'colloquial-points', 'place-labels'].forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility);
    });
    e.target.textContent = placesVisible ? 'Hide Places' : 'Show Places';
  });
}

// Metric selector dropdown
const metricSelector = document.getElementById('metricSelector');
if (metricSelector) {
  // Populate options dynamically from METRICS
  metricSelector.innerHTML = Object.keys(METRICS).map(key =>
    `<option value="${key}"${key === DEFAULT_METRIC ? ' selected' : ''}>${METRICS[key].label}</option>`
  ).join('');
  metricSelector.addEventListener('change', (e) => setMetric(e.target.value));
}

// Time slider — drag to scrub years on year-aware metrics
const yearRange = document.getElementById('yearRange');
if (yearRange) {
  yearRange.addEventListener('input', (e) => {
    const year = parseInt(e.target.value, 10);
    currentYear = year;
    const yearLabel = document.querySelector('.time-slider-year');
    if (yearLabel) yearLabel.textContent = year;
    if (map.getLayer('census-fill')) {
      map.setPaintProperty(
        'census-fill',
        'fill-color',
        buildFillColorExpression(currentMetric, currentYear)
      );
    }
  });
}

// Initialize legend on load
window.addEventListener('DOMContentLoaded', () => updateLegend(DEFAULT_METRIC));

// =============================================================
// 11. ERROR HANDLING (token missing nudge)
// =============================================================
// =============================================================
// 13. VOICE CONTROL API — exposed as window.chapinMap
// -------------------------------------------------------------
// voice.js calls these when the agent invokes a client-side tool.
// =============================================================
const FLY_TARGETS = {
  'chapin':                  { center: [-81.3528, 34.1654], zoom: 13,  pitch: 50, bearing:   0 },
  'chapin town hall':        { center: [-81.3527, 34.1654], zoom: 15,  pitch: 60, bearing:   0 },
  'chapin town':             { center: [-81.3527, 34.1654], zoom: 14,  pitch: 55, bearing:   0 },
  'chapin high school':      { center: [-81.3478, 34.1611], zoom: 15,  pitch: 60, bearing:  30 },
  'chapin high':             { center: [-81.3478, 34.1611], zoom: 15,  pitch: 60, bearing:  30 },
  'lake murray dam':         { center: [-81.2128, 34.0523], zoom: 14,  pitch: 65, bearing:  90 },
  'saluda dam':              { center: [-81.2128, 34.0523], zoom: 14,  pitch: 65, bearing:  90 },
  'crooked creek park':      { center: [-81.3484, 34.1789], zoom: 15,  pitch: 60, bearing:   0 },
  'irmo':                    { center: [-81.180,  34.090],  zoom: 13,  pitch: 50, bearing:   0 },
  'ballentine':              { center: [-81.282,  34.118],  zoom: 14,  pitch: 55, bearing:   0 },
  'white rock':              { center: [-81.222,  34.137],  zoom: 14,  pitch: 55, bearing:   0 },
  'lake murray':             { center: [-81.32,   34.05],   zoom: 11,  pitch: 30, bearing:   0 },
  'lake murray of richland': { center: [-81.27,   34.10],   zoom: 13,  pitch: 50, bearing:   0 },
  'greater chapin':          { center: [-81.30,   34.13],   zoom: 12,  pitch: 40, bearing:   0 },
  'columbia':                { center: [-81.034,  34.000],  zoom: 11,  pitch: 40, bearing:   0 },
  'lexington county':        { center: [-81.24,   33.91],   zoom: 10,  pitch: 30, bearing:   0 },
  'lexington':               { center: [-81.24,   33.91],   zoom: 10,  pitch: 30, bearing:   0 },
  'richland county':         { center: [-80.88,   34.04],   zoom: 10,  pitch: 30, bearing:   0 },
  'richland':                { center: [-80.88,   34.04],   zoom: 10,  pitch: 30, bearing:   0 },
  'home':                    { center: CHAPIN_CENTER,        zoom: DEFAULT_ZOOM, pitch: DEFAULT_PITCH, bearing: DEFAULT_BEARING },
  'reset':                   { center: CHAPIN_CENTER,        zoom: DEFAULT_ZOOM, pitch: DEFAULT_PITCH, bearing: DEFAULT_BEARING },
  'default':                 { center: CHAPIN_CENTER,        zoom: DEFAULT_ZOOM, pitch: DEFAULT_PITCH, bearing: DEFAULT_BEARING },
};

window.chapinMap = {
  flyTo(placeName) {
    if (!placeName) return { success: false, error: 'Need a place name.' };
    const key = String(placeName).toLowerCase().trim();

    let target = FLY_TARGETS[key];
    if (!target) {
      const matchedKey = Object.keys(FLY_TARGETS).find(k => key.includes(k) || k.includes(key));
      if (matchedKey) target = FLY_TARGETS[matchedKey];
    }

    if (!target) {
      return {
        success: false,
        error: `Don't know where "${placeName}" is. Try Chapin, Irmo, White Rock, Ballentine, Lake Murray Dam, Greater Chapin, Lexington County, or Richland County.`,
      };
    }

    map.flyTo({ ...target, duration: 2400, essential: true });
    return { success: true, flew_to: placeName, center: target.center, zoom: target.zoom };
  },

  setMetric(metricKey) {
    // Aliases — map natural language to actual metric keys
    const aliases = {
      'race':                'pct_nonwhite',
      'racial':              'pct_nonwhite',
      'racial composition':  'pct_nonwhite',
      'diversity':           'pct_nonwhite',
      'demographics':        'pct_nonwhite',
      'income':              'median_income',
      'household income':    'median_income',
      'wealth':              'median_income',
      'age':                 'median_age',
      'median age':          'median_age',
      'density':             'density_per_sqkm',
      'population density':  'density_per_sqkm',
      'growth':              'growth_pct',
      'population growth':   'growth_pct',
      'population':          'population_by_year',
      'population by year':  'population_by_year',
      'time':                'population_by_year',
      'over time':           'population_by_year',
      'annual':              'population_by_year',
      'history':             'population_by_year',
    };
    const lower = String(metricKey || '').toLowerCase().trim();
    const resolved = METRICS[lower] ? lower : (aliases[lower] || metricKey);

    if (!METRICS[resolved]) {
      return {
        success: false,
        error: `Unknown metric "${metricKey}". Try: race, income, age, density, growth, or population (over time).`,
      };
    }
    setMetric(resolved);
    const sel = document.getElementById('metricSelector');
    if (sel) sel.value = resolved;
    return { success: true, metric: resolved, label: METRICS[resolved].label };
  },

  setYear(year) {
    const y = parseInt(year, 10);
    if (isNaN(y)) return { success: false, error: 'Year must be a number.' };

    const m = METRICS[currentMetric];
    if (!m?.isYearAware) {
      setMetric('population_by_year');
      const sel = document.getElementById('metricSelector');
      if (sel) sel.value = 'population_by_year';
    }

    const yrs = METRICS.population_by_year.years;
    const clamped = Math.max(yrs[0], Math.min(yrs[yrs.length - 1], y));
    currentYear = clamped;

    const range = document.getElementById('yearRange');
    if (range) range.value = clamped;
    const yearLabel = document.querySelector('.time-slider-year');
    if (yearLabel) yearLabel.textContent = clamped;

    if (map.getLayer('census-fill')) {
      map.setPaintProperty('census-fill', 'fill-color', buildFillColorExpression(currentMetric, clamped));
    }
    return { success: true, year: clamped };
  },

  toggleLayer(layerName) {
    const l = String(layerName || '').toLowerCase().trim();
    if (l.includes('place')) {
      document.getElementById('togglePlaces')?.click();
      return { success: true, toggled: 'places' };
    }
    if (l.includes('cinematic') || l.includes('space')) {
      document.getElementById('toggleCinematic')?.click();
      return { success: true, toggled: 'cinematic' };
    }
    if (l.includes('3d') || l.includes('2d')) {
      document.getElementById('toggle3D')?.click();
      return { success: true, toggled: '3d' };
    }
    if (l.includes('style') || l.includes('satellite') || l.includes('dark') || l.includes('basemap')) {
      document.getElementById('cycleStyle')?.click();
      return { success: true, toggled: 'style' };
    }
    return { success: false, error: `Unknown layer "${layerName}". Try: places, cinematic, 3d, style.` };
  },

  reset() {
    map.flyTo({
      center: CHAPIN_CENTER, zoom: DEFAULT_ZOOM, pitch: DEFAULT_PITCH, bearing: DEFAULT_BEARING,
      duration: 1800, essential: true,
    });
    return { success: true };
  },
};

console.log('🎙️  Voice control API ready (window.chapinMap).');

// =============================================================
// 14. ERROR HANDLING (token missing nudge)
// =============================================================
map.on('error', (err) => {
  if (mapboxgl.accessToken === 'PASTE_YOUR_MAPBOX_TOKEN_HERE') {
    document.body.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100vh;
                  font-family:system-ui;background:#0a0a0a;color:#f5f5f5;padding:24px;text-align:center;">
        <div style="max-width:480px;">
          <h1 style="font-family:'Libre Baskerville',serif;font-size:28px;margin-bottom:12px;">Almost there</h1>
          <p style="line-height:1.5;color:#ccc;">Open <code>map.js</code> and paste your Mapbox public token (starts with <code>pk.</code>) at the top.</p>
        </div>
      </div>`;
  } else {
    console.error('Mapbox error:', err);
  }
});
