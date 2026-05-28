/* ============================================================
   The Sumter Map
   Mapbox 3D map of Sumter County, SC, with:
     - Census tract choropleth (15 switchable metrics)
     - Place boundaries (Sumter city, Mayesville, Pinewood)
     - Cinematic clip mode
     - Voice agent integration (handled in voice.js)
   ============================================================ */

// =============================================================
// 1. MAPBOX TOKEN
// =============================================================
mapboxgl.accessToken = 'pk.eyJ1IjoiamltbXlhcmRpcyIsImEiOiJjbW93d3EzOGowaHBiMnJvZngweWIxZXN6In0.DGI7a-dUV1fphfE4uP-HwQ';

// =============================================================
// 2. SUMTER, SOUTH CAROLINA
// =============================================================
const SUMTER_CENTER = [-80.3412, 33.9204];
const DEFAULT_ZOOM = 10;
const DEFAULT_PITCH = 35;
const DEFAULT_BEARING = 0;

// =============================================================
// 3. LANDMARKS
// =============================================================
const LANDMARKS = [
  { name: 'Downtown Sumter',         coordinates: [-80.3412, 33.9204], description: 'Historic core of Sumter — county courthouse, Main Street commerce.' },
  { name: 'Shaw Air Force Base',     coordinates: [-80.4714, 33.9726], description: 'Home of the 20th Fighter Wing. One of the largest Air Force installations in the Southeast.' },
  { name: 'Swan Lake Iris Gardens',  coordinates: [-80.3459, 33.9164], description: 'Nationally recognized garden featuring all 8 species of native North American swans.' },
  { name: 'Manchester State Forest', coordinates: [-80.3713, 33.7772], description: '28,000-acre state forest — longleaf pine restoration, hiking, equestrian trails.' },
];

// =============================================================
// 4. DATA LAYER PATHS
// =============================================================
const CENSUS_GEOJSON_PATH   = 'data/sumter-area-tracts.geojson';
const PLACES_GEOJSON_PATH   = 'data/sumter-places.geojson';
const CINEMATIC_SHAPES_PATH = 'data/sumter-cinematic-shapes.geojson';

// Bounding box of Sumter County
const SUMTER_COUNTY_BOUNDS = [
  [-80.88, 33.68],  // SW corner [lng, lat]
  [-79.84, 34.20],  // NE corner
];

// =============================================================
// 5. METRICS — each one defines its own choropleth + legend
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

  population_by_year: {
    label: 'Population (drag time slider)',
    isYearAware: true,
    years: [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023],
    defaultYear: 2023,
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

  poverty_rate: {
    label: 'Poverty rate (ACS 2023)',
    property: 'poverty_rate',
    nullCheck: ['==', ['get', 'poverty_rate'], null],
    nullColor: 'rgba(180,180,180,0.55)',
    nullLabel: 'No data',
    stops: [[0, '#fff5f0'], [5, '#fdd0a2'], [10, '#fc8d59'], [20, '#d7191c'], [35, '#7f0000']],
    legendLabels: ['0%', '5%', '10%', '20%', '35%+'],
    formatPopup: v => v == null ? 'n/a' : `${parseFloat(v).toFixed(1)}%`,
    legendGradient: 'linear-gradient(to right,#fff5f0,#fdd0a2,#fc8d59,#d7191c,#7f0000)',
  },

  median_home_value: {
    label: 'Median home value (ACS 2023)',
    property: 'median_home_value',
    nullCheck: ['==', ['get', 'median_home_value'], null],
    nullColor: 'rgba(180,180,180,0.55)',
    nullLabel: 'No data',
    stops: [[0, '#f7fbff'], [100000, '#c6dbef'], [200000, '#6baed6'], [350000, '#2171b5'], [600000, '#08306b']],
    legendLabels: ['$0', '$100k', '$200k', '$350k', '$600k+'],
    formatPopup: v => v == null ? 'n/a' : '$' + Number(v).toLocaleString(),
    legendGradient: 'linear-gradient(to right,#f7fbff,#c6dbef,#6baed6,#2171b5,#08306b)',
  },

  median_gross_rent: {
    label: 'Median gross rent (ACS 2023)',
    property: 'median_gross_rent',
    nullCheck: ['==', ['get', 'median_gross_rent'], null],
    nullColor: 'rgba(180,180,180,0.55)',
    nullLabel: 'No data',
    stops: [[0, '#fcfbfd'], [600, '#dadaeb'], [900, '#9e9ac8'], [1200, '#6a51a3'], [1800, '#3f007d']],
    legendLabels: ['$0', '$600', '$900', '$1.2k', '$1.8k+'],
    formatPopup: v => v == null ? 'n/a' : '$' + Number(v).toLocaleString() + '/mo',
    legendGradient: 'linear-gradient(to right,#fcfbfd,#dadaeb,#9e9ac8,#6a51a3,#3f007d)',
  },

  owner_occ_rate: {
    label: 'Owner-occupancy rate (ACS 2023)',
    property: 'owner_occ_rate',
    nullCheck: ['==', ['get', 'owner_occ_rate'], null],
    nullColor: 'rgba(180,180,180,0.55)',
    nullLabel: 'No data',
    stops: [[0, '#fff7ec'], [25, '#fdd49e'], [50, '#fc8d59'], [65, '#d7301f'], [80, '#7f0000']],
    legendLabels: ['0%', '25%', '50%', '65%', '80%+'],
    formatPopup: v => v == null ? 'n/a' : `${parseFloat(v).toFixed(1)}%`,
    legendGradient: 'linear-gradient(to right,#fff7ec,#fdd49e,#fc8d59,#d7301f,#7f0000)',
  },

  vacancy_rate: {
    label: 'Vacancy rate (ACS 2023)',
    property: 'vacancy_rate',
    nullCheck: ['==', ['get', 'vacancy_rate'], null],
    nullColor: 'rgba(180,180,180,0.55)',
    nullLabel: 'No data',
    stops: [[0, '#ffffd9'], [5, '#edf8b1'], [10, '#7fcdbb'], [20, '#1d91c0'], [35, '#081d58']],
    legendLabels: ['0%', '5%', '10%', '20%', '35%+'],
    formatPopup: v => v == null ? 'n/a' : `${parseFloat(v).toFixed(1)}%`,
    legendGradient: 'linear-gradient(to right,#ffffd9,#edf8b1,#7fcdbb,#1d91c0,#081d58)',
  },

  pct_single_family: {
    label: 'Single-family housing share (ACS 2023)',
    property: 'pct_single_family',
    nullCheck: ['==', ['get', 'pct_single_family'], null],
    nullColor: 'rgba(180,180,180,0.55)',
    nullLabel: 'No data',
    stops: [[0, '#f7fcf0'], [25, '#ccebc5'], [50, '#7bccc4'], [70, '#2b8cbe'], [90, '#084081']],
    legendLabels: ['0%', '25%', '50%', '70%', '90%+'],
    formatPopup: v => v == null ? 'n/a' : `${parseFloat(v).toFixed(1)}%`,
    legendGradient: 'linear-gradient(to right,#f7fcf0,#ccebc5,#7bccc4,#2b8cbe,#084081)',
  },

  median_year_built: {
    label: 'Median year built (ACS 2023)',
    property: 'median_year_built',
    nullCheck: ['==', ['get', 'median_year_built'], null],
    nullColor: 'rgba(180,180,180,0.55)',
    nullLabel: 'No data',
    stops: [[1940, '#7f3b08'], [1960, '#b35806'], [1980, '#e08214'], [2000, '#8073ac'], [2015, '#40004b']],
    legendLabels: ['~1940', '~1960', '~1980', '~2000', '~2015+'],
    formatPopup: v => v == null ? 'n/a' : String(Math.round(v)),
    legendGradient: 'linear-gradient(to right,#7f3b08,#b35806,#e08214,#8073ac,#40004b)',
  },

  pct_bachelors_plus: {
    label: "Bachelor's degree or higher (ACS 2023)",
    property: 'pct_bachelors_plus',
    nullCheck: ['==', ['get', 'pct_bachelors_plus'], null],
    nullColor: 'rgba(180,180,180,0.55)',
    nullLabel: 'No data',
    stops: [[0, '#f7f4f9'], [15, '#d4b9da'], [30, '#c994c7'], [50, '#dd1c77'], [70, '#67001f']],
    legendLabels: ['0%', '15%', '30%', '50%', '70%+'],
    formatPopup: v => v == null ? 'n/a' : `${parseFloat(v).toFixed(1)}%`,
    legendGradient: 'linear-gradient(to right,#f7f4f9,#d4b9da,#c994c7,#dd1c77,#67001f)',
  },

  unemployment_rate: {
    label: 'Unemployment rate (ACS 2023)',
    property: 'unemployment_rate',
    nullCheck: ['==', ['get', 'unemployment_rate'], null],
    nullColor: 'rgba(180,180,180,0.55)',
    nullLabel: 'No data',
    stops: [[0, '#fff5eb'], [3, '#fdd0a2'], [6, '#fd8d3c'], [10, '#d94701'], [18, '#7f2704']],
    legendLabels: ['0%', '3%', '6%', '10%', '18%+'],
    formatPopup: v => v == null ? 'n/a' : `${parseFloat(v).toFixed(1)}%`,
    legendGradient: 'linear-gradient(to right,#fff5eb,#fdd0a2,#fd8d3c,#d94701,#7f2704)',
  },

  pct_wfh: {
    label: 'Work from home share (ACS 2023)',
    property: 'pct_wfh',
    nullCheck: ['==', ['get', 'pct_wfh'], null],
    nullColor: 'rgba(180,180,180,0.55)',
    nullLabel: 'No data',
    stops: [[0, '#f0f9e8'], [5, '#bae4bc'], [10, '#7bccc4'], [20, '#2b8cbe'], [35, '#0868ac']],
    legendLabels: ['0%', '5%', '10%', '20%', '35%+'],
    formatPopup: v => v == null ? 'n/a' : `${parseFloat(v).toFixed(1)}%`,
    legendGradient: 'linear-gradient(to right,#f0f9e8,#bae4bc,#7bccc4,#2b8cbe,#0868ac)',
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
  if (m.legendGradient) return m.legendGradient;
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
  if (titleEl)   titleEl.textContent = m.label;
  if (gradEl)    gradEl.style.background = gradientCss(metricKey);
  if (labelsEl)  labelsEl.innerHTML = m.legendLabels.map(l => `<span>${l}</span>`).join('');
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
  const range = slider.querySelector('#yearRange');
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
  center: SUMTER_CENTER,
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

  // Census choropleth
  try {
    map.addSource('sumter-area-tracts', { type: 'geojson', data: CENSUS_GEOJSON_PATH, promoteId: 'GEOID' });
    map.addLayer({
      id: 'census-fill', type: 'fill', source: 'sumter-area-tracts', slot: 'bottom',
      paint: {
        'fill-color': buildFillColorExpression(DEFAULT_METRIC),
        'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.85, 0.65],
      },
    });
    map.addLayer({
      id: 'census-outline', type: 'line', source: 'sumter-area-tracts', slot: 'middle',
      paint: {
        'line-color': 'rgba(255, 255, 255, 0.7)',
        'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2.5, 0.6],
      },
    });
    console.log('🏘️  Census layer loaded.');
  } catch (err) { console.error('Census layer failed:', err); }

  // Place boundaries
  try {
    map.addSource('sumter-places', { type: 'geojson', data: PLACES_GEOJSON_PATH });
    map.addLayer({
      id: 'place-outline', type: 'line', source: 'sumter-places',
      filter: ['any', ['==', ['get', 'kind'], 'incorporated_city'], ['==', ['get', 'kind'], 'incorporated_town'], ['==', ['get', 'kind'], 'cdp']],
      slot: 'top',
      paint: { 'line-color': '#8B5E3C', 'line-width': 2.4 },
    });
    map.addLayer({
      id: 'place-labels', type: 'symbol', source: 'sumter-places',
      slot: 'top',
      layout: {
        'text-field': ['get', 'display_name'],
        'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10, 14, 14],
        'text-offset': [0, 1.0], 'text-anchor': 'top', 'text-allow-overlap': false,
      },
      paint: { 'text-color': '#5a3a1a', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 },
    });
    console.log('🏛️  Place boundaries loaded.');
  } catch (err) { console.error('Place layer failed:', err); }

  // Cinematic shapes
  try {
    map.addSource('sumter-cinematic', { type: 'geojson', data: CINEMATIC_SHAPES_PATH });
    map.addLayer({
      id: 'cinematic-mask', type: 'fill', source: 'sumter-cinematic',
      filter: ['==', ['get', 'kind'], 'inverted_mask'], slot: 'top',
      layout: { visibility: 'none' },
      paint: { 'fill-color': '#05050a', 'fill-opacity': 0.96 },
    });
    map.addLayer({
      id: 'cinematic-glow', type: 'line', source: 'sumter-cinematic',
      filter: ['==', ['get', 'kind'], 'greater_sumter_union'], slot: 'top',
      layout: { visibility: 'none' },
      paint: { 'line-color': '#c8a46a', 'line-width': 3, 'line-blur': 2, 'line-opacity': 0.9 },
    });
    console.log('✦  Cinematic shapes loaded.');
  } catch (err) { console.error('Cinematic shapes failed:', err); }

  // Landmark pins
  LANDMARKS.forEach((landmark) => {
    const popup = new mapboxgl.Popup({ offset: 25, closeButton: false }).setHTML(`
      <div class="marker-popup"><h3>${landmark.name}</h3><p>${landmark.description}</p></div>`);
    new mapboxgl.Marker({ color: '#7B5C3A' }).setLngLat(landmark.coordinates).setPopup(popup).addTo(map);
  });

  console.log('🗺️  Sumter map loaded.');
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
    map.setFeatureState({ source: 'sumter-area-tracts', id: hoveredTractId }, { hover: false });
  }
  hoveredTractId = newId;
  map.setFeatureState({ source: 'sumter-area-tracts', id: hoveredTractId }, { hover: true });
});

map.on('mouseleave', 'census-fill', () => {
  map.getCanvas().style.cursor = '';
  if (hoveredTractId !== null) {
    map.setFeatureState({ source: 'sumter-area-tracts', id: hoveredTractId }, { hover: false });
  }
  hoveredTractId = null;
});

map.on('click', 'census-fill', (e) => {
  if (e.features.length === 0) return;
  const p = e.features[0].properties;
  const name = p.NAME || `Tract ${p.TRACT}`;

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
      <div class="tract-county">Sumter County, SC</div>
      <div class="tract-stat-grid">
        ${stat('Pop 2020', p.pop_2020 != null ? Number(p.pop_2020).toLocaleString() : 'n/a')}
        ${stat('Growth', fmt('growth_pct'))}
        ${stat('Median income', fmt('median_income'))}
        ${stat('Poverty rate', fmt('poverty_rate'))}
        ${stat('Home value', fmt('median_home_value'))}
        ${stat('Median age', fmt('median_age'))}
      </div>
    </div>`;

  new mapboxgl.Popup({ offset: 4, maxWidth: '300px' }).setLngLat(e.lngLat).setHTML(body).addTo(map);
});

// =============================================================
// 9. PLACES INTERACTION
// =============================================================
['place-outline'].forEach((layerId) => {
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
  map.flyTo({ center: SUMTER_CENTER, zoom: DEFAULT_ZOOM, pitch: DEFAULT_PITCH, bearing: DEFAULT_BEARING, duration: 1800, essential: true });
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
  try { map.setConfigProperty('basemap', 'lightPreset', preset); e.target.textContent = `Lighting: ${preset}`; } catch (err) {}
});

// Style cycle
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

// Cinematic mode
let cinematicMode = false;
const cinematicBtn = document.getElementById('toggleCinematic');
if (cinematicBtn) {
  cinematicBtn.addEventListener('click', (e) => {
    cinematicMode = !cinematicMode;
    document.body.classList.toggle('cinematic', cinematicMode);

    if (cinematicMode) {
      if (map.getLayer('cinematic-mask')) map.setLayoutProperty('cinematic-mask', 'visibility', 'visible');
      if (map.getLayer('cinematic-glow')) map.setLayoutProperty('cinematic-glow', 'visibility', 'visible');
      try { map.setConfigProperty('basemap', 'showPointOfInterestLabels', false); } catch (err) {}
      try { map.setConfigProperty('basemap', 'showPlaceLabels',           false); } catch (err) {}
      try { map.setConfigProperty('basemap', 'showRoadLabels',            false); } catch (err) {}
      try { map.setConfigProperty('basemap', 'showTransitLabels',         false); } catch (err) {}
      try { map.setProjection('globe'); } catch (err) {}
      try {
        map.setFog({
          'color': 'rgba(8, 8, 12, 1)', 'high-color': '#0a0a14',
          'space-color': '#000000', 'horizon-blend': 0.04, 'star-intensity': 1.0,
        });
      } catch (err) {}
      map.fitBounds(SUMTER_COUNTY_BOUNDS, { padding: { top: 80, bottom: 120, left: 80, right: 80 }, pitch: 55, bearing: -15, duration: 2400, essential: true });
      e.target.textContent = '✦ Exit cinematic';
    } else {
      if (map.getLayer('cinematic-mask')) map.setLayoutProperty('cinematic-mask', 'visibility', 'none');
      if (map.getLayer('cinematic-glow')) map.setLayoutProperty('cinematic-glow', 'visibility', 'none');
      try { map.setConfigProperty('basemap', 'showPointOfInterestLabels', true); } catch (err) {}
      try { map.setConfigProperty('basemap', 'showPlaceLabels',           true); } catch (err) {}
      try { map.setConfigProperty('basemap', 'showRoadLabels',            true); } catch (err) {}
      try { map.setConfigProperty('basemap', 'showTransitLabels',         true); } catch (err) {}
      try { map.setProjection('mercator'); } catch (err) {}
      try { map.setFog(null); } catch (err) {}
      map.easeTo({ center: SUMTER_CENTER, zoom: DEFAULT_ZOOM, pitch: DEFAULT_PITCH, bearing: DEFAULT_BEARING, duration: 1800, essential: true });
      e.target.textContent = '✦ Cinematic';
    }
  });
}

function reAddDataLayers() {
  if (!map.getSource('sumter-area-tracts')) {
    try {
      map.addSource('sumter-area-tracts', { type: 'geojson', data: CENSUS_GEOJSON_PATH, promoteId: 'GEOID' });
      map.addLayer({ id: 'census-fill', type: 'fill', source: 'sumter-area-tracts', slot: 'bottom', paint: { 'fill-color': buildFillColorExpression(currentMetric, currentYear), 'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.85, 0.65] } });
      map.addLayer({ id: 'census-outline', type: 'line', source: 'sumter-area-tracts', slot: 'middle', paint: { 'line-color': 'rgba(255,255,255,0.7)', 'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2.5, 0.6] } });
    } catch (err) { console.error('Re-add Census failed:', err); }
  }
  if (!map.getSource('sumter-places')) {
    try {
      map.addSource('sumter-places', { type: 'geojson', data: PLACES_GEOJSON_PATH });
      map.addLayer({ id: 'place-outline', type: 'line', source: 'sumter-places', filter: ['any', ['==', ['get', 'kind'], 'incorporated_city'], ['==', ['get', 'kind'], 'incorporated_town'], ['==', ['get', 'kind'], 'cdp']], slot: 'top', paint: { 'line-color': '#8B5E3C', 'line-width': 2.4 } });
      map.addLayer({ id: 'place-labels', type: 'symbol', source: 'sumter-places', slot: 'top', layout: { 'text-field': ['get', 'display_name'], 'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10, 14, 14], 'text-offset': [0, 1.0], 'text-anchor': 'top', 'text-allow-overlap': false }, paint: { 'text-color': '#5a3a1a', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 } });
    } catch (err) { console.error('Re-add places failed:', err); }
  }
}

let placesVisible = true;
const placesBtn = document.getElementById('togglePlaces');
if (placesBtn) {
  placesBtn.addEventListener('click', (e) => {
    placesVisible = !placesVisible;
    const visibility = placesVisible ? 'visible' : 'none';
    ['place-outline', 'place-labels'].forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility);
    });
    e.target.textContent = placesVisible ? 'Hide Places' : 'Show Places';
  });
}

// Metric selector
const metricSelector = document.getElementById('metricSelector');
if (metricSelector) {
  metricSelector.innerHTML = Object.keys(METRICS).map(key =>
    `<option value="${key}"${key === DEFAULT_METRIC ? ' selected' : ''}>${METRICS[key].label}</option>`
  ).join('');
  metricSelector.addEventListener('change', (e) => setMetric(e.target.value));
}

// Time slider
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
// 11. VOICE CONTROL API — exposed as window.sumterMap
// =============================================================
const FLY_TARGETS = {
  'sumter':                   { center: [-80.3412, 33.9204], zoom: 12,  pitch: 45, bearing:  0 },
  'downtown sumter':          { center: [-80.3412, 33.9204], zoom: 15,  pitch: 60, bearing: 10 },
  'downtown':                 { center: [-80.3412, 33.9204], zoom: 15,  pitch: 60, bearing: 10 },
  'shaw air force base':      { center: [-80.4714, 33.9726], zoom: 13,  pitch: 50, bearing: 30 },
  'shaw afb':                 { center: [-80.4714, 33.9726], zoom: 13,  pitch: 50, bearing: 30 },
  'shaw':                     { center: [-80.4714, 33.9726], zoom: 13,  pitch: 50, bearing: 30 },
  'shaw air force':           { center: [-80.4714, 33.9726], zoom: 13,  pitch: 50, bearing: 30 },
  'swan lake':                { center: [-80.3459, 33.9164], zoom: 15,  pitch: 55, bearing:  0 },
  'swan lake iris gardens':   { center: [-80.3459, 33.9164], zoom: 16,  pitch: 60, bearing:  0 },
  'manchester state forest':  { center: [-80.3713, 33.7772], zoom: 12,  pitch: 40, bearing:  0 },
  'manchester forest':        { center: [-80.3713, 33.7772], zoom: 12,  pitch: 40, bearing:  0 },
  'manchester':               { center: [-80.3713, 33.7772], zoom: 12,  pitch: 40, bearing:  0 },
  'mayesville':               { center: [-80.2003, 34.0059], zoom: 13,  pitch: 40, bearing:  0 },
  'pinewood':                 { center: [-80.4576, 33.7369], zoom: 13,  pitch: 40, bearing:  0 },
  'sumter county':            { center: [-80.3412, 33.9400], zoom: 10,  pitch: 20, bearing:  0 },
  'home':    { center: SUMTER_CENTER, zoom: DEFAULT_ZOOM, pitch: DEFAULT_PITCH, bearing: DEFAULT_BEARING },
  'reset':   { center: SUMTER_CENTER, zoom: DEFAULT_ZOOM, pitch: DEFAULT_PITCH, bearing: DEFAULT_BEARING },
  'default': { center: SUMTER_CENTER, zoom: DEFAULT_ZOOM, pitch: DEFAULT_PITCH, bearing: DEFAULT_BEARING },
};

window.sumterMap = {
  flyTo(placeName) {
    if (!placeName) return { success: false, error: 'Need a place name.' };
    const key = String(placeName).toLowerCase().trim();
    let target = FLY_TARGETS[key];
    if (!target) {
      const matchedKey = Object.keys(FLY_TARGETS).find(k => key.includes(k) || k.includes(key));
      if (matchedKey) target = FLY_TARGETS[matchedKey];
    }
    if (!target) return { success: false, error: `Don't know where "${placeName}" is. Try Downtown, Shaw AFB, Swan Lake, Manchester Forest, Mayesville, or Pinewood.` };
    map.flyTo({ ...target, duration: 2400, essential: true });
    return { success: true, flew_to: placeName, center: target.center, zoom: target.zoom };
  },

  setMetric(metricKey) {
    const aliases = {
      'race': 'pct_nonwhite', 'racial': 'pct_nonwhite', 'diversity': 'pct_nonwhite', 'demographics': 'pct_nonwhite',
      'income': 'median_income', 'household income': 'median_income', 'wealth': 'median_income',
      'age': 'median_age', 'median age': 'median_age',
      'density': 'density_per_sqkm', 'population density': 'density_per_sqkm',
      'growth': 'growth_pct', 'population growth': 'growth_pct',
      'population': 'population_by_year', 'population by year': 'population_by_year',
      'time': 'population_by_year', 'over time': 'population_by_year', 'annual': 'population_by_year',
      'poverty': 'poverty_rate', 'poor': 'poverty_rate',
      'home value': 'median_home_value', 'home values': 'median_home_value', 'property value': 'median_home_value',
      'rent': 'median_gross_rent', 'rents': 'median_gross_rent', 'rental': 'median_gross_rent',
      'owners': 'owner_occ_rate', 'ownership': 'owner_occ_rate', 'owner occupancy': 'owner_occ_rate',
      'vacancy': 'vacancy_rate', 'vacant': 'vacancy_rate',
      'single family': 'pct_single_family', 'housing type': 'pct_single_family',
      'year built': 'median_year_built', 'housing age': 'median_year_built',
      'education': 'pct_bachelors_plus', 'college': 'pct_bachelors_plus', 'degree': 'pct_bachelors_plus',
      'unemployment': 'unemployment_rate', 'jobs': 'unemployment_rate',
      'work from home': 'pct_wfh', 'remote work': 'pct_wfh', 'wfh': 'pct_wfh',
    };
    const lower = String(metricKey || '').toLowerCase().trim();
    const resolved = METRICS[lower] ? lower : (aliases[lower] || metricKey);
    if (!METRICS[resolved]) return { success: false, error: `Unknown metric "${metricKey}". Try: race, income, age, density, growth, poverty, or population.` };
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
    return { success: false, error: `Unknown layer "${layerName}". Try: places, cinematic, 3d, style.` };
  },

  reset() {
    map.flyTo({ center: SUMTER_CENTER, zoom: DEFAULT_ZOOM, pitch: DEFAULT_PITCH, bearing: DEFAULT_BEARING, duration: 1800, essential: true });
    return { success: true };
  },
};

map.on('error', (err) => { console.error('Mapbox error:', err); });

console.log('🎙️  Voice control API ready (window.sumterMap).');
