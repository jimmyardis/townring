/* ============================================================
   The Columbia Map
   Mapbox 3D map of Columbia SC + Richland County, with:
     - Census tract choropleth (switchable across 5 metrics)
     - Place boundaries (Columbia, Forest Acres, Cayce, etc.)
     - Tax-productivity parcel overlay ($/acre)
     - Voice agent integration (handled in voice.js)
   ============================================================ */

// =============================================================
// 1. MAPBOX TOKEN
// =============================================================
mapboxgl.accessToken = 'pk.eyJ1IjoiamltbXlhcmRpcyIsImEiOiJjbW93d3EzOGowaHBiMnJvZngweWIxZXN6In0.DGI7a-dUV1fphfE4uP-HwQ';

// =============================================================
// 2. COLUMBIA, SOUTH CAROLINA
// =============================================================
const COLUMBIA_CENTER = [-81.0348, 34.0007];
const DEFAULT_ZOOM    = 12;
const DEFAULT_PITCH   = 30;
const DEFAULT_BEARING = 0;

// =============================================================
// 3. LANDMARKS
// =============================================================
const LANDMARKS = [
  { name: 'South Carolina State House', coordinates: [-81.0334, 34.0001], description: 'The seat of South Carolina state government since 1903.' },
  { name: 'USC Horseshoe',              coordinates: [-81.0298, 33.9987], description: 'The historic heart of the University of South Carolina campus.' },
  { name: 'Five Points',                coordinates: [-81.0229, 33.9966], description: 'Columbia\'s historic entertainment district at the junction of five streets.' },
  { name: 'The Vista',                  coordinates: [-81.0430, 34.0010], description: 'Columbia\'s gallery and restaurant district along the Congaree riverfront.' },
  { name: 'Colonial Life Arena',        coordinates: [-81.0458, 34.0042], description: 'Home of the USC Gamecocks basketball and a major concert venue.' },
];

// =============================================================
// 4. DATA LAYER PATHS
// =============================================================
const CENSUS_GEOJSON_PATH   = 'data/columbia-area-tracts.geojson';
const PLACES_GEOJSON_PATH   = 'data/columbia-places.geojson';
const CINEMATIC_SHAPES_PATH = 'data/columbia-cinematic-shapes.geojson';
const PRODUCTIVITY_PATH     = 'productivity/citywide/data_slim.geojson';

// Tax/acre color stops — calibrated to Columbia's range (median ~$26k, p95 ~$100k)
const TAX_ACRE_STOPS = [
  [0,       '#d4d4c8'],
  [5000,    '#e8cf8a'],
  [20000,   '#c9a55a'],
  [50000,   '#d4541a'],
  [100000,  '#9e2a2b'],
  [300000,  '#4a0a0a'],
];

// Bounding box of Richland County (approximate)
const GREATER_COLUMBIA_BOUNDS = [
  [-81.40, 33.75],  // SW corner [lng, lat]
  [-80.55, 34.30],  // NE corner
];

// =============================================================
// 5. METRICS
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
      [ 200, '#deebf7'],
      [ 800, '#9ecae1'],
      [2000, '#4292c6'],
      [4000, '#2171b5'],
      [8000, '#08306b'],
    ],
    legendLabels: ['0', '800', '2k', '8k+ /km²'],
    formatPopup: v => v == null ? 'n/a' : `${Math.round(v).toLocaleString()} /km²`,
  },

  median_income: {
    label: 'Median household income',
    property: 'median_income',
    nullCheck: ['==', ['get', 'median_income'], null],
    nullColor: 'rgba(180, 180, 180, 0.55)',
    nullLabel: 'No data',
    stops: [
      [ 20000, '#ffffe5'],
      [ 40000, '#d9f0a3'],
      [ 60000, '#78c679'],
      [ 90000, '#41ab5d'],
      [140000, '#005a32'],
    ],
    legendLabels: ['$20k', '$40k', '$90k', '$140k+'],
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
      [28, '#fdd0a2'],
      [36, '#fd8d3c'],
      [45, '#d94801'],
      [60, '#7f2704'],
    ],
    legendLabels: ['20', '28', '36', '60+'],
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

  population_by_year: {
    label: 'Population (drag time slider)',
    isYearAware: true,
    years: [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022],
    defaultYear: 2022,
    propertyTemplate: 'pop_{year}',
    nullColor: 'rgba(180, 180, 180, 0.55)',
    nullLabel: 'No data for this year',
    stops: [
      [    0, '#fff5eb'],
      [ 2000, '#fdd0a2'],
      [ 5000, '#fd8d3c'],
      [10000, '#d94801'],
      [20000, '#7f2704'],
    ],
    legendLabels: ['0', '2k', '5k', '20k+'],
    formatPopup: v => v == null ? 'no data' : Number(v).toLocaleString(),
  },
};

const DEFAULT_METRIC = 'growth_pct';
let currentMetric = DEFAULT_METRIC;
let currentYear = null;

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

  if (titleEl)   titleEl.textContent  = m.label;
  if (gradEl)    gradEl.style.background = gradientCss(metricKey);
  if (labelsEl)  labelsEl.innerHTML   = m.legendLabels.map(l => `<span>${l}</span>`).join('');
  if (nullDescr) nullDescr.textContent = m.nullLabel;
}

function setMetric(metricKey) {
  if (!METRICS[metricKey]) return;
  currentMetric = metricKey;
  const m = METRICS[metricKey];

  if (m.isYearAware) {
    if (currentYear == null || !m.years.includes(currentYear)) currentYear = m.defaultYear;
    showTimeSlider(m, currentYear);
  } else {
    currentYear = null;
    hideTimeSlider();
  }

  if (map.getLayer('census-fill')) {
    map.setPaintProperty('census-fill', 'fill-color', buildFillColorExpression(metricKey, currentYear));
  }
  updateLegend(metricKey);
}

function showTimeSlider(metric, year) {
  const slider = document.getElementById('timeSlider');
  if (!slider) return;
  const range     = slider.querySelector('#yearRange');
  const yearLabel = slider.querySelector('.time-slider-year');
  const boundsEls = slider.querySelectorAll('.time-slider-bounds span');
  if (range) { range.min = metric.years[0]; range.max = metric.years[metric.years.length - 1]; range.step = 1; range.value = year; }
  if (yearLabel) yearLabel.textContent = year;
  if (boundsEls.length >= 2) { boundsEls[0].textContent = metric.years[0]; boundsEls[1].textContent = metric.years[metric.years.length - 1]; }
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
  center: COLUMBIA_CENTER,
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
  try { map.setConfigProperty('basemap', 'lightPreset', 'day'); } catch (e) {}

  // -------- 7b. Census choropleth --------
  try {
    map.addSource('columbia-area-tracts', { type: 'geojson', data: CENSUS_GEOJSON_PATH, promoteId: 'GEOID' });
    map.addLayer({
      id: 'census-fill', type: 'fill', source: 'columbia-area-tracts', slot: 'bottom',
      paint: {
        'fill-color': buildFillColorExpression(DEFAULT_METRIC),
        'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.85, 0.65],
      },
    });
    map.addLayer({
      id: 'census-outline', type: 'line', source: 'columbia-area-tracts', slot: 'middle',
      paint: {
        'line-color': 'rgba(255, 255, 255, 0.7)',
        'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2.5, 0.6],
      },
    });
  } catch (err) { console.error('Census layer failed:', err); }

  // -------- 7c. Place boundaries --------
  try {
    map.addSource('columbia-places', { type: 'geojson', data: PLACES_GEOJSON_PATH });
    map.addLayer({
      id: 'place-outline', type: 'line', source: 'columbia-places',
      filter: ['any', ['==', ['get', 'kind'], 'incorporated_town'], ['==', ['get', 'kind'], 'cdp']],
      slot: 'top',
      paint: { 'line-color': '#a07d2e', 'line-width': 2.4 },
    });
    map.addLayer({
      id: 'colloquial-points', type: 'circle', source: 'columbia-places',
      filter: ['==', ['get', 'kind'], 'colloquial'], slot: 'top',
      paint: { 'circle-radius': 7, 'circle-color': '#c9a55a', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 },
    });
    map.addLayer({
      id: 'place-labels', type: 'symbol', source: 'columbia-places',
      filter: ['!=', ['get', 'kind'], 'zip'], slot: 'top',
      layout: {
        'text-field': ['get', 'display_name'],
        'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10, 14, 14],
        'text-offset': [0, 1.0], 'text-anchor': 'top', 'text-allow-overlap': false,
      },
      paint: { 'text-color': '#5a4015', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 },
    });
  } catch (err) { console.error('Place layer failed:', err); }

  // -------- 7d. Cinematic clip shapes --------
  try {
    map.addSource('columbia-cinematic', { type: 'geojson', data: CINEMATIC_SHAPES_PATH });
    map.addLayer({
      id: 'cinematic-mask', type: 'fill', source: 'columbia-cinematic',
      filter: ['==', ['get', 'kind'], 'inverted_mask'], slot: 'top',
      layout: { visibility: 'none' },
      paint: { 'fill-color': '#05050a', 'fill-opacity': 0.96 },
    });
    map.addLayer({
      id: 'cinematic-glow', type: 'line', source: 'columbia-cinematic',
      filter: ['==', ['get', 'kind'], 'greater_columbia_union'], slot: 'top',
      layout: { visibility: 'none' },
      paint: { 'line-color': '#e8c87a', 'line-width': 3, 'line-blur': 2, 'line-opacity': 0.9 },
    });
  } catch (err) { console.error('Cinematic shapes failed:', err); }

  // -------- 7e. Landmark pins --------
  LANDMARKS.forEach((landmark) => {
    const popup = new mapboxgl.Popup({ offset: 25, closeButton: false }).setHTML(`
      <div class="marker-popup"><h3>${landmark.name}</h3><p>${landmark.description}</p></div>`);
    new mapboxgl.Marker({ color: '#c1392b' }).setLngLat(landmark.coordinates).setPopup(popup).addTo(map);
  });

  // -------- 7f. Productivity parcel layer (hidden by default) --------
  try {
    map.addSource('columbia-productivity', { type: 'geojson', data: PRODUCTIVITY_PATH, promoteId: 'pid' });
    map.addLayer({
      id: 'productivity-fill', type: 'fill', source: 'columbia-productivity', slot: 'top',
      layout: { visibility: 'none' },
      paint: {
        'fill-color': [
          'case',
          ['!', ['has', 'tax_per_acre']], '#d4d4c8',
          ['interpolate', ['linear'], ['get', 'tax_per_acre'], ...TAX_ACRE_STOPS.flat()],
        ],
        'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.95, 0.80],
      },
    });
    map.addLayer({
      id: 'productivity-outline', type: 'line', source: 'columbia-productivity', slot: 'top',
      layout: { visibility: 'none' },
      paint: { 'line-color': 'rgba(255,255,255,0.5)', 'line-width': 0.4 },
    });
    console.log('Productivity layer loaded.');
  } catch (err) { console.warn('Productivity layer not loaded:', err.message); }

  console.log('🗺️  Columbia map loaded.');
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
    map.setFeatureState({ source: 'columbia-area-tracts', id: hoveredTractId }, { hover: false });
  }
  hoveredTractId = newId;
  map.setFeatureState({ source: 'columbia-area-tracts', id: hoveredTractId }, { hover: true });
});

map.on('mouseleave', 'census-fill', () => {
  map.getCanvas().style.cursor = '';
  if (hoveredTractId !== null) {
    map.setFeatureState({ source: 'columbia-area-tracts', id: hoveredTractId }, { hover: false });
  }
  hoveredTractId = null;
});

map.on('click', 'census-fill', (e) => {
  if (e.features.length === 0) return;
  const p = e.features[0].properties;
  const name = p.NAME || `Tract ${p.TRACT}`;
  const countyTag = p.county_name ? `<div class="tract-county">${p.county_name} County, SC</div>` : '';

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
// 8b. PRODUCTIVITY HOVER + CLICK
// =============================================================
let hoveredParcelId = null;

map.on('mousemove', 'productivity-fill', (e) => {
  if (!e.features.length) return;
  map.getCanvas().style.cursor = 'pointer';
  const newId = e.features[0].id;
  if (hoveredParcelId !== null && hoveredParcelId !== newId) {
    map.setFeatureState({ source: 'columbia-productivity', id: hoveredParcelId }, { hover: false });
  }
  hoveredParcelId = newId;
  map.setFeatureState({ source: 'columbia-productivity', id: hoveredParcelId }, { hover: true });
});
map.on('mouseleave', 'productivity-fill', () => {
  map.getCanvas().style.cursor = '';
  if (hoveredParcelId !== null) {
    map.setFeatureState({ source: 'columbia-productivity', id: hoveredParcelId }, { hover: false });
  }
  hoveredParcelId = null;
});
map.on('click', 'productivity-fill', (e) => {
  if (!e.features.length) return;
  const p = e.features[0].properties;
  const tpa = p.tax_per_acre != null ? '$' + Math.round(p.tax_per_acre).toLocaleString() + '/ac' : 'n/a';
  const vpa = p.value_per_acre != null ? '$' + Math.round(p.value_per_acre).toLocaleString() + '/ac' : 'n/a';
  const tax = p.est_tax_net != null ? '$' + Math.round(p.est_tax_net).toLocaleString() + '/yr' : 'n/a';
  const flags = [
    p.legal_residence ? '🏠 Owner-occupied' : null,
    p.is_civic_exempt  ? '⛪ Civic/exempt'   : null,
  ].filter(Boolean).join('<br>');
  new mapboxgl.Popup({ offset: 4, maxWidth: '280px' })
    .setLngLat(e.lngLat)
    .setHTML(`<div class="tract-popup">
      <h3>${p.address || 'Parcel'}</h3>
      <div class="tract-county">${p.area_short || ''}</div>
      <div class="tract-stat"><span class="label">Tax/acre</span><span class="value">${tpa}</span></div>
      <div class="tract-stat"><span class="label">Value/acre</span><span class="value">${vpa}</span></div>
      <div class="tract-stat"><span class="label">Annual tax</span><span class="value">${tax}</span></div>
      ${flags ? `<div class="tract-note" style="margin-top:6px;">${flags}</div>` : ''}
    </div>`)
    .addTo(map);
  e.originalEvent.stopPropagation();
});

// =============================================================
// 9. PLACES INTERACTION
// =============================================================
['place-outline', 'colloquial-points'].forEach((layerId) => {
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
  map.flyTo({ center: COLUMBIA_CENTER, zoom: DEFAULT_ZOOM, pitch: DEFAULT_PITCH, bearing: DEFAULT_BEARING, duration: 1800, essential: true });
});

let in3DMode = true;
document.getElementById('toggle3D').addEventListener('click', (e) => {
  in3DMode = !in3DMode;
  map.easeTo({ pitch: in3DMode ? DEFAULT_PITCH : 0, bearing: DEFAULT_BEARING, duration: 1200 });
  e.target.textContent = in3DMode ? 'Toggle 3D' : 'Toggle 2D';
});

const LIGHT_PRESETS = ['day', 'dusk', 'dawn', 'night'];
let lightIndex = 0;
document.getElementById('cycleLight').addEventListener('click', (e) => {
  lightIndex = (lightIndex + 1) % LIGHT_PRESETS.length;
  const preset = LIGHT_PRESETS[lightIndex];
  try { map.setConfigProperty('basemap', 'lightPreset', preset); e.target.textContent = `Lighting: ${preset}`; } catch (err) {}
});

// =============================================================
// 11. STYLE CYCLE
// =============================================================
const STYLES = [
  { id: 'mapbox://styles/mapbox/standard',              label: 'standard'  },
  { id: 'mapbox://styles/mapbox/satellite-streets-v12', label: 'satellite' },
  { id: 'mapbox://styles/mapbox/dark-v11',              label: 'dark'      },
];
let styleIndex = 0;
const cycleStyleBtn = document.getElementById('cycleStyle');
if (cycleStyleBtn) {
  cycleStyleBtn.addEventListener('click', (e) => {
    styleIndex = (styleIndex + 1) % STYLES.length;
    const next = STYLES[styleIndex];
    e.target.textContent = `Style: ${next.label}`;
    map.setStyle(next.id);
    map.once('style.load', () => {
      try { map.setConfigProperty('basemap', 'lightPreset', LIGHT_PRESETS[lightIndex]); } catch (err) {}
      reAddDataLayers();
    });
  });
}

// =============================================================
// 12. CINEMATIC MODE
// =============================================================
let cinematicMode = false;
const cinematicBtn = document.getElementById('toggleCinematic');
if (cinematicBtn) {
  cinematicBtn.addEventListener('click', (e) => {
    cinematicMode = !cinematicMode;
    document.body.classList.toggle('cinematic', cinematicMode);

    if (cinematicMode) {
      if (map.getLayer('cinematic-mask')) map.setLayoutProperty('cinematic-mask', 'visibility', 'visible');
      if (map.getLayer('cinematic-glow'))  map.setLayoutProperty('cinematic-glow',  'visibility', 'visible');
      try { map.setConfigProperty('basemap', 'showPointOfInterestLabels', false); } catch (err) {}
      try { map.setConfigProperty('basemap', 'showPlaceLabels',           false); } catch (err) {}
      try { map.setConfigProperty('basemap', 'showRoadLabels',            false); } catch (err) {}
      try { map.setProjection('globe'); } catch (err) {}
      try {
        map.setFog({ 'color': 'rgba(8, 8, 12, 1)', 'high-color': '#0a0a14', 'space-color': '#000000', 'horizon-blend': 0.04, 'star-intensity': 1.0 });
      } catch (err) {}
      map.fitBounds(GREATER_COLUMBIA_BOUNDS, { padding: { top: 80, bottom: 120, left: 80, right: 80 }, pitch: 55, bearing: -15, duration: 2400, essential: true });
      e.target.textContent = '✦ Exit cinematic';
    } else {
      if (map.getLayer('cinematic-mask')) map.setLayoutProperty('cinematic-mask', 'visibility', 'none');
      if (map.getLayer('cinematic-glow'))  map.setLayoutProperty('cinematic-glow',  'visibility', 'none');
      try { map.setConfigProperty('basemap', 'showPointOfInterestLabels', true); } catch (err) {}
      try { map.setConfigProperty('basemap', 'showPlaceLabels',           true); } catch (err) {}
      try { map.setConfigProperty('basemap', 'showRoadLabels',            true); } catch (err) {}
      try { map.setProjection('mercator'); } catch (err) {}
      try { map.setFog(null); } catch (err) {}
      map.easeTo({ center: COLUMBIA_CENTER, zoom: DEFAULT_ZOOM, pitch: DEFAULT_PITCH, bearing: DEFAULT_BEARING, duration: 1800, essential: true });
      e.target.textContent = '✦ Cinematic';
    }
  });
}

function reAddDataLayers() {
  if (!map.getSource('columbia-area-tracts')) {
    try {
      map.addSource('columbia-area-tracts', { type: 'geojson', data: CENSUS_GEOJSON_PATH, promoteId: 'GEOID' });
      map.addLayer({
        id: 'census-fill', type: 'fill', source: 'columbia-area-tracts', slot: 'bottom',
        paint: { 'fill-color': buildFillColorExpression(currentMetric, currentYear), 'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.85, 0.65] },
      });
      map.addLayer({
        id: 'census-outline', type: 'line', source: 'columbia-area-tracts', slot: 'middle',
        paint: { 'line-color': 'rgba(255, 255, 255, 0.7)', 'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2.5, 0.6] },
      });
    } catch (err) { console.error('Re-add Census failed:', err); }
  }
  if (!map.getSource('columbia-places')) {
    try {
      map.addSource('columbia-places', { type: 'geojson', data: PLACES_GEOJSON_PATH });
      map.addLayer({ id: 'place-outline', type: 'line', source: 'columbia-places', filter: ['any', ['==', ['get', 'kind'], 'incorporated_town'], ['==', ['get', 'kind'], 'cdp']], slot: 'top', paint: { 'line-color': '#a07d2e', 'line-width': 2.4 } });
      map.addLayer({ id: 'colloquial-points', type: 'circle', source: 'columbia-places', filter: ['==', ['get', 'kind'], 'colloquial'], slot: 'top', paint: { 'circle-radius': 7, 'circle-color': '#c9a55a', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } });
      map.addLayer({ id: 'place-labels', type: 'symbol', source: 'columbia-places', filter: ['!=', ['get', 'kind'], 'zip'], slot: 'top', layout: { 'text-field': ['get', 'display_name'], 'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10, 14, 14], 'text-offset': [0, 1.0], 'text-anchor': 'top', 'text-allow-overlap': false }, paint: { 'text-color': '#5a4015', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 } });
    } catch (err) { console.error('Re-add places failed:', err); }
  }
}

let placesVisible = true;
let productivityVisible = false;
const placesBtn = document.getElementById('togglePlaces');
if (placesBtn) {
  placesBtn.addEventListener('click', (e) => {
    placesVisible = !placesVisible;
    const visibility = placesVisible ? 'visible' : 'none';
    ['place-outline', 'colloquial-points', 'place-labels'].forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility);
    });
    e.target.textContent = placesVisible ? 'Hide Places' : 'Show Places';
  });
}

const metricSelector = document.getElementById('metricSelector');
if (metricSelector) {
  metricSelector.innerHTML = Object.keys(METRICS).map(key =>
    `<option value="${key}"${key === DEFAULT_METRIC ? ' selected' : ''}>${METRICS[key].label}</option>`
  ).join('');
  metricSelector.addEventListener('change', (e) => setMetric(e.target.value));
}

const yearRange = document.getElementById('yearRange');
if (yearRange) {
  yearRange.addEventListener('input', (e) => {
    const year = parseInt(e.target.value, 10);
    currentYear = year;
    const yearLabel = document.querySelector('.time-slider-year');
    if (yearLabel) yearLabel.textContent = year;
    if (map.getLayer('census-fill')) {
      map.setPaintProperty('census-fill', 'fill-color', buildFillColorExpression(currentMetric, currentYear));
    }
  });
}

window.addEventListener('DOMContentLoaded', () => updateLegend(DEFAULT_METRIC));

// =============================================================
// 13. VOICE CONTROL API — window.columbiaMap
// =============================================================
const FLY_TARGETS = {
  'columbia':              { center: [-81.0348, 34.0007], zoom: 12,   pitch: 30, bearing:  0 },
  'state house':           { center: [-81.0334, 34.0001], zoom: 16,   pitch: 60, bearing: 15 },
  'south carolina state house': { center: [-81.0334, 34.0001], zoom: 16, pitch: 60, bearing: 15 },
  'usc':                   { center: [-81.0298, 33.9987], zoom: 15,   pitch: 55, bearing:  0 },
  'usc horseshoe':         { center: [-81.0298, 33.9987], zoom: 16,   pitch: 60, bearing:  0 },
  'university of south carolina': { center: [-81.0298, 33.9987], zoom: 15, pitch: 55, bearing: 0 },
  'five points':           { center: [-81.0229, 33.9966], zoom: 16,   pitch: 60, bearing: 30 },
  'the vista':             { center: [-81.0430, 34.0010], zoom: 15,   pitch: 55, bearing:  0 },
  'vista':                 { center: [-81.0430, 34.0010], zoom: 15,   pitch: 55, bearing:  0 },
  'colonial life arena':   { center: [-81.0458, 34.0042], zoom: 16,   pitch: 60, bearing:  0 },
  'forest acres':          { center: [-80.9980, 33.9918], zoom: 14,   pitch: 40, bearing:  0 },
  'cayce':                 { center: [-81.0718, 33.9707], zoom: 13,   pitch: 40, bearing:  0 },
  'west columbia':         { center: [-81.0718, 33.9934], zoom: 13,   pitch: 40, bearing:  0 },
  'irmo':                  { center: [-81.1840, 34.0901], zoom: 13,   pitch: 40, bearing:  0 },
  'blythewood':            { center: [-80.9793, 34.2162], zoom: 13,   pitch: 40, bearing:  0 },
  'eastover':              { center: [-80.6877, 33.8892], zoom: 13,   pitch: 40, bearing:  0 },
  'arcadia lakes':         { center: [-80.9699, 34.0557], zoom: 14,   pitch: 40, bearing:  0 },
  'richland county':       { center: [-80.88,   34.04],   zoom: 10,   pitch: 20, bearing:  0 },
  'congaree river':        { center: [-81.10,   33.97],   zoom: 12,   pitch: 40, bearing:  0 },
  'congaree':              { center: [-81.10,   33.97],   zoom: 12,   pitch: 40, bearing:  0 },
  'home':   { center: COLUMBIA_CENTER, zoom: DEFAULT_ZOOM, pitch: DEFAULT_PITCH, bearing: DEFAULT_BEARING },
  'reset':  { center: COLUMBIA_CENTER, zoom: DEFAULT_ZOOM, pitch: DEFAULT_PITCH, bearing: DEFAULT_BEARING },
  'default':{ center: COLUMBIA_CENTER, zoom: DEFAULT_ZOOM, pitch: DEFAULT_PITCH, bearing: DEFAULT_BEARING },
};

window.columbiaMap = {
  flyTo(placeName) {
    if (!placeName) return { success: false, error: 'Need a place name.' };
    const key = String(placeName).toLowerCase().trim();
    let target = FLY_TARGETS[key];
    if (!target) {
      const matchedKey = Object.keys(FLY_TARGETS).find(k => key.includes(k) || k.includes(key));
      if (matchedKey) target = FLY_TARGETS[matchedKey];
    }
    if (!target) return { success: false, error: `Don't know where "${placeName}" is. Try State House, USC, Five Points, Vista, Forest Acres, Cayce, or West Columbia.` };
    map.flyTo({ ...target, duration: 2400, essential: true });
    return { success: true, flew_to: placeName, center: target.center, zoom: target.zoom };
  },

  setMetric(metricKey) {
    const aliases = {
      'race': 'pct_nonwhite', 'racial': 'pct_nonwhite', 'diversity': 'pct_nonwhite',
      'demographics': 'pct_nonwhite', 'racial composition': 'pct_nonwhite',
      'income': 'median_income', 'household income': 'median_income', 'wealth': 'median_income',
      'age': 'median_age', 'median age': 'median_age',
      'density': 'density_per_sqkm', 'population density': 'density_per_sqkm',
      'growth': 'growth_pct', 'population growth': 'growth_pct',
      'population': 'population_by_year', 'population by year': 'population_by_year',
      'time': 'population_by_year', 'over time': 'population_by_year',
      'annual': 'population_by_year', 'history': 'population_by_year',
    };
    const lower = String(metricKey || '').toLowerCase().trim();
    const resolved = METRICS[lower] ? lower : (aliases[lower] || metricKey);
    if (!METRICS[resolved]) return { success: false, error: `Unknown metric "${metricKey}". Try: race, income, age, density, growth, or population.` };
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
    if (l.includes('place')) { document.getElementById('togglePlaces')?.click(); return { success: true, toggled: 'places' }; }
    if (l.includes('cinematic') || l.includes('space')) { document.getElementById('toggleCinematic')?.click(); return { success: true, toggled: 'cinematic' }; }
    if (l.includes('3d') || l.includes('2d')) { document.getElementById('toggle3D')?.click(); return { success: true, toggled: '3d' }; }
    if (l.includes('style') || l.includes('satellite') || l.includes('dark') || l.includes('basemap')) { document.getElementById('cycleStyle')?.click(); return { success: true, toggled: 'style' }; }
    if (l.includes('productivity') || l.includes('tax') || l.includes('parcel') || l.includes('per acre') || l.includes('$/acre')) {
      document.getElementById('toggleProductivity')?.click();
      return { success: true, toggled: 'productivity' };
    }
    return { success: false, error: `Unknown layer "${layerName}". Try: places, cinematic, 3d, style, or productivity.` };
  },

  toggleProductivity() {
    productivityVisible = !productivityVisible;
    const vis = productivityVisible ? 'visible' : 'none';
    ['productivity-fill', 'productivity-outline'].forEach(id => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
    });
    const btn = document.getElementById('toggleProductivity');
    if (btn) {
      btn.textContent = productivityVisible ? 'Hide $/Acre' : '$/Acre';
      btn.style.background = productivityVisible ? '#9e2a2b' : '';
      btn.style.color = productivityVisible ? '#fff' : '';
    }
    if (productivityVisible) {
      map.flyTo({ center: [-81.0334, 34.0001], zoom: 14, pitch: 50, bearing: 0, duration: 2000, essential: true });
    }
    return { success: true, productivity_visible: productivityVisible };
  },

  reset() {
    map.flyTo({ center: COLUMBIA_CENTER, zoom: DEFAULT_ZOOM, pitch: DEFAULT_PITCH, bearing: DEFAULT_BEARING, duration: 1800, essential: true });
    return { success: true };
  },
};

document.getElementById('toggleProductivity')?.addEventListener('click', () => window.columbiaMap.toggleProductivity());

console.log('🎙️  Voice control API ready (window.columbiaMap).');

map.on('error', (err) => { console.error('Mapbox error:', err); });
