/* ============================================================
   The Charleston Map — TownRing
   Mapbox 3D map of Charleston SC metro with Census choropleth,
   place boundaries, voice control API, and cinematic mode.
   Counties: Charleston (019), Berkeley (015), Dorchester (035)
   ============================================================ */

// =============================================================
// 1. MAPBOX TOKEN
// =============================================================
mapboxgl.accessToken = 'pk.eyJ1IjoiamltbXlhcmRpcyIsImEiOiJjbW95cDhiOWEwZGNwMnNxNjU5MnNybGdzIn0.kXOm1Xhn4MGll3Z9PNqmbA';

// =============================================================
// 2. CHARLESTON CONSTANTS
// =============================================================
const CHARLESTON_CENTER   = [-79.9399, 32.7765];
const DEFAULT_ZOOM        = 10;
const DEFAULT_PITCH       = 35;
const DEFAULT_BEARING     = 0;

// Bounding box for "Greater Charleston" fitBounds calls
const GREATER_CHARLESTON_BOUNDS = [
  [-80.55, 32.35],   // SW
  [-79.55, 33.25],   // NE
];

// =============================================================
// 3. METRICS — choropleth data layers
// =============================================================
const METRICS = {
  growth_pct: {
    label: 'Population growth, 2010 → 2020',
    property: 'growth_pct',
    nullCheck: ['==', ['get', 'has_2010'], false],
    nullColor: 'rgba(180,180,180,0.55)',
    nullLabel: 'New tract since 2010',
    stops: [[-15, '#4a4a4a'], [-5, '#888888'], [0, '#f3e8d6'], [10, '#8fc4d6'], [25, '#2a7f9e'], [50, '#0e4d6c'], [85, '#062d40']],
    legendLabels: ['-15%', '0%', '+25%', '+85%'],
    formatPopup: v => v == null ? 'n/a' : `${v > 0 ? '+' : ''}${parseFloat(v).toFixed(1)}%`,
    legendGradient: 'linear-gradient(to right,#4a4a4a 0%,#888 15%,#f3e8d6 28%,#8fc4d6 50%,#2a7f9e 70%,#0e4d6c 88%,#062d40 100%)',
  },
  pop_2020: {
    label: 'Population, 2020',
    property: 'pop_2020',
    nullCheck: ['!', ['has', 'pop_2020']],
    nullColor: 'rgba(180,180,180,0.55)',
    nullLabel: 'No data',
    stops: [[0, '#fff5eb'], [1000, '#fdd0a2'], [3000, '#fd8d3c'], [6000, '#d94701'], [10000, '#7f2704']],
    legendLabels: ['0', '1k', '3k', '6k', '10k+'],
    formatPopup: v => v == null ? 'n/a' : Number(v).toLocaleString(),
    legendGradient: 'linear-gradient(to right,#fff5eb,#fdd0a2,#fd8d3c,#d94701,#7f2704)',
  },
  pop_by_year: {
    label: 'Population by year (ACS)',
    isYearAware: true,
    years: [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024],
    defaultYear: 2024,
    propertyTemplate: 'pop_{year}',
    nullCheck: ['!', ['has', 'pop_2024']],
    nullColor: 'rgba(180,180,180,0.55)',
    nullLabel: 'No data',
    stops: [[0, '#fff5eb'], [1000, '#fdd0a2'], [3000, '#fd8d3c'], [6000, '#d94701'], [10000, '#7f2704']],
    legendLabels: ['0', '1k', '3k', '6k', '10k+'],
    formatPopup: v => v == null ? 'n/a' : Number(v).toLocaleString(),
    legendGradient: 'linear-gradient(to right,#fff5eb,#fdd0a2,#fd8d3c,#d94701,#7f2704)',
  },
  median_income: {
    label: 'Median household income',
    property: 'median_income',
    nullCheck: ['==', ['get', 'median_income'], null],
    nullColor: 'rgba(180,180,180,0.55)',
    nullLabel: 'No data',
    stops: [[0, '#f7fcf5'], [35000, '#c7e9c0'], [60000, '#74c476'], [90000, '#238b45'], [140000, '#00441b']],
    legendLabels: ['$0', '$35k', '$60k', '$90k', '$140k+'],
    formatPopup: v => v == null ? 'n/a' : '$' + Number(v).toLocaleString(),
    legendGradient: 'linear-gradient(to right,#f7fcf5,#c7e9c0,#74c476,#238b45,#00441b)',
  },
  median_age: {
    label: 'Median age',
    property: 'median_age',
    nullCheck: ['==', ['get', 'median_age'], null],
    nullColor: 'rgba(180,180,180,0.55)',
    nullLabel: 'No data',
    stops: [[18, '#fcfbfd'], [28, '#dadaeb'], [38, '#9e9ac8'], [48, '#6a51a3'], [65, '#3f007d']],
    legendLabels: ['18', '28', '38', '48', '65+'],
    formatPopup: v => v == null ? 'n/a' : `${parseFloat(v).toFixed(1)} yrs`,
    legendGradient: 'linear-gradient(to right,#fcfbfd,#dadaeb,#9e9ac8,#6a51a3,#3f007d)',
  },
  pct_nonwhite: {
    label: 'Percent non-white',
    property: 'pct_nonwhite',
    nullCheck: ['==', ['get', 'pct_nonwhite'], null],
    nullColor: 'rgba(180,180,180,0.55)',
    nullLabel: 'No data',
    stops: [[0, '#f7fcfd'], [20, '#ccece6'], [40, '#66c2a4'], [60, '#2ca25f'], [80, '#006d2c']],
    legendLabels: ['0%', '20%', '40%', '60%', '80%+'],
    formatPopup: v => v == null ? 'n/a' : `${parseFloat(v).toFixed(1)}%`,
    legendGradient: 'linear-gradient(to right,#f7fcfd,#ccece6,#66c2a4,#2ca25f,#006d2c)',
  },
  poverty_rate: {
    label: 'Poverty rate (ACS 2024)',
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
    label: 'Median home value (ACS 2024)',
    property: 'median_home_value',
    nullCheck: ['==', ['get', 'median_home_value'], null],
    nullColor: 'rgba(180,180,180,0.55)',
    nullLabel: 'No data',
    stops: [[0, '#f7fbff'], [150000, '#c6dbef'], [300000, '#6baed6'], [500000, '#2171b5'], [800000, '#08306b']],
    legendLabels: ['$0', '$150k', '$300k', '$500k', '$800k+'],
    formatPopup: v => v == null ? 'n/a' : '$' + Number(v).toLocaleString(),
    legendGradient: 'linear-gradient(to right,#f7fbff,#c6dbef,#6baed6,#2171b5,#08306b)',
  },
  median_gross_rent: {
    label: 'Median gross rent (ACS 2024)',
    property: 'median_gross_rent',
    nullCheck: ['==', ['get', 'median_gross_rent'], null],
    nullColor: 'rgba(180,180,180,0.55)',
    nullLabel: 'No data',
    stops: [[0, '#fcfbfd'], [800, '#dadaeb'], [1200, '#9e9ac8'], [1600, '#6a51a3'], [2200, '#3f007d']],
    legendLabels: ['$0', '$800', '$1.2k', '$1.6k', '$2.2k+'],
    formatPopup: v => v == null ? 'n/a' : '$' + Number(v).toLocaleString() + '/mo',
    legendGradient: 'linear-gradient(to right,#fcfbfd,#dadaeb,#9e9ac8,#6a51a3,#3f007d)',
  },
  owner_occ_rate: {
    label: 'Owner-occupancy rate (ACS 2024)',
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
    label: 'Vacancy rate (ACS 2024)',
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
    label: 'Single-family housing share (ACS 2024)',
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
    label: 'Median year built (ACS 2024)',
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
    label: "Bachelor's degree or higher (ACS 2024)",
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
    label: 'Unemployment rate (ACS 2024)',
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
    label: 'Work from home share (ACS 2024)',
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

// =============================================================
// 4. FLY TARGETS — named places the voice agent can navigate to
// =============================================================
const FLY_TARGETS = {
  'downtown':             { center: [-79.9399, 32.7765], zoom: 14,   pitch: 50, bearing: 15,  label: 'Downtown Charleston' },
  'the battery':          { center: [-79.9400, 32.7686], zoom: 15,   pitch: 45, bearing: 0,   label: 'The Battery' },
  'white point garden':   { center: [-79.9400, 32.7686], zoom: 15.5, pitch: 45, bearing: 0,   label: 'White Point Garden' },
  'ravenel bridge':       { center: [-79.9271, 32.7984], zoom: 14.5, pitch: 55, bearing: 30,  label: 'Arthur Ravenel Jr. Bridge' },
  'fort sumter':          { center: [-79.8747, 32.7525], zoom: 14.5, pitch: 40, bearing: 0,   label: 'Fort Sumter' },
  'rainbow row':          { center: [-79.9359, 32.7737], zoom: 16,   pitch: 45, bearing: -10, label: 'Rainbow Row' },
  'folly beach':          { center: [-79.9399, 32.6534], zoom: 13.5, pitch: 30, bearing: 0,   label: 'Folly Beach' },
  "sullivan's island":    { center: [-79.8365, 32.7678], zoom: 13,   pitch: 30, bearing: 0,   label: "Sullivan's Island" },
  'mount pleasant':       { center: [-79.8626, 32.8323], zoom: 12,   pitch: 30, bearing: 0,   label: 'Mount Pleasant' },
  'north charleston':     { center: [-80.0000, 32.8795], zoom: 11.5, pitch: 25, bearing: 0,   label: 'North Charleston' },
  'james island':         { center: [-79.9739, 32.7351], zoom: 12.5, pitch: 25, bearing: 0,   label: 'James Island' },
  'johns island':         { center: [-80.0723, 32.7179], zoom: 12,   pitch: 25, bearing: 0,   label: 'Johns Island' },
  'west ashley':          { center: [-80.0183, 32.7615], zoom: 12.5, pitch: 25, bearing: 0,   label: 'West Ashley' },
  'summerville':          { center: [-80.1759, 33.0185], zoom: 12,   pitch: 20, bearing: 0,   label: 'Summerville' },
  'goose creek':          { center: [-80.0323, 32.9816], zoom: 12,   pitch: 20, bearing: 0,   label: 'Goose Creek' },
  'daniel island':        { center: [-79.9221, 32.8558], zoom: 13,   pitch: 30, bearing: 0,   label: 'Daniel Island' },
  'isle of palms':        { center: [-79.7842, 32.7852], zoom: 13,   pitch: 25, bearing: 0,   label: 'Isle of Palms' },
  'kiawah island':        { center: [-80.0837, 32.6076], zoom: 13,   pitch: 25, bearing: 0,   label: 'Kiawah Island' },
  "patriots point":       { center: [-79.8978, 32.7905], zoom: 14.5, pitch: 40, bearing: 0,   label: "Patriots Point" },
  'college of charleston':{ center: [-79.9383, 32.7752], zoom: 16,   pitch: 45, bearing: 0,   label: 'College of Charleston' },
  'musc':                 { center: [-79.9445, 32.7832], zoom: 15.5, pitch: 40, bearing: 0,   label: 'MUSC Medical Center' },
  'the citadel':          { center: [-79.9613, 32.8042], zoom: 15,   pitch: 40, bearing: 0,   label: 'The Citadel' },
  'port of charleston':   { center: [-79.9233, 32.7888], zoom: 13.5, pitch: 50, bearing: 20,  label: 'Port of Charleston' },
  'shem creek':           { center: [-79.8811, 32.7812], zoom: 14.5, pitch: 35, bearing: 0,   label: 'Shem Creek' },
  'wadmalaw island':      { center: [-80.1637, 32.6677], zoom: 12.5, pitch: 20, bearing: 0,   label: 'Wadmalaw Island' },
  'edisto island':        { center: [-80.3127, 32.5146], zoom: 12,   pitch: 20, bearing: 0,   label: 'Edisto Island' },
  'cainhoy':              { center: [-79.8182, 32.8956], zoom: 12.5, pitch: 20, bearing: 0,   label: 'Cainhoy Peninsula' },
  'moncks corner':        { center: [-80.0068, 33.1963], zoom: 12,   pitch: 20, bearing: 0,   label: 'Moncks Corner' },
  'hanahan':              { center: [-79.9994, 32.9212], zoom: 12.5, pitch: 20, bearing: 0,   label: 'Hanahan' },
  'ladson':               { center: [-80.1095, 32.9835], zoom: 12.5, pitch: 20, bearing: 0,   label: 'Ladson' },
};

// =============================================================
// 5. LANDMARKS
// =============================================================
const LANDMARKS = [
  { name: 'The Battery', coordinates: [-79.9400, 32.7686], description: 'Historic promenade at the southern tip of the Charleston peninsula.' },
  { name: 'Arthur Ravenel Jr. Bridge', coordinates: [-79.9271, 32.7984], description: 'Cable-stayed bridge over the Cooper River, opened 2005. 2.7 miles long.' },
  { name: 'Fort Sumter', coordinates: [-79.8747, 32.7525], description: 'Federally-held fort in Charleston Harbor where the Civil War began, April 12, 1861.' },
  { name: 'Rainbow Row', coordinates: [-79.9359, 32.7737], description: 'Thirteen pastel-painted Georgian row houses — the longest such stretch in the US.' },
  { name: 'Folly Beach', coordinates: [-79.9399, 32.6534], description: 'Barrier island 6 miles south of downtown, known as the "Edge of America."' },
  { name: 'Patriots Point', coordinates: [-79.8978, 32.7905], description: 'Naval museum in Mount Pleasant, home to the USS Yorktown aircraft carrier.' },
  { name: 'The Citadel', coordinates: [-79.9613, 32.8042], description: 'South Carolina\'s military college, established 1842.' },
  { name: 'College of Charleston', coordinates: [-79.9383, 32.7752], description: 'Founded 1770 — the oldest municipal college in the United States.' },
];

// =============================================================
// 6. DATA PATHS
// =============================================================
const TRACTS_PATH        = 'data/charleston-area-tracts.geojson';
const PLACES_PATH        = 'data/charleston-places.geojson';
const CINEMATIC_PATH     = 'data/charleston-cinematic-shapes.geojson';
const PRODUCTIVITY_PATH  = 'productivity/three-area/data.geojson';   // Walled City + CENA + West Ashley
const PRODUCTIVITY_CITYWIDE_PATH = 'productivity/citywide/data_slim.geojson';

// Tax/acre color stops — log-friendly scale, tells the Strong Towns story
const TAX_ACRE_STOPS = [
  [0,       '#d4d4c8'],  // no value / surface parking
  [10000,   '#e8cf8a'],  // very low (suburban strip)
  [50000,   '#c9a84c'],  // low-moderate
  [150000,  '#d4541a'],  // moderate-high
  [400000,  '#9e2a2b'],  // high (dense historic)
  [1000000, '#4a0a0a'],  // exceptional
];

// =============================================================
// 7. MAP INIT
// =============================================================
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/standard',
  center: CHARLESTON_CENTER,
  zoom: DEFAULT_ZOOM,
  pitch: DEFAULT_PITCH,
  bearing: DEFAULT_BEARING,
  antialias: true,
});

map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'bottom-right');

// =============================================================
// 8. CHOROPLETH EXPRESSION BUILDER
// =============================================================
let currentMetric = 'pop_by_year';
let currentYear   = 2024;

function buildFillColorExpression(metricKey, year) {
  const m = METRICS[metricKey];
  if (!m) return '#cccccc';

  const property = m.isYearAware
    ? m.propertyTemplate.replace('{year}', year ?? currentYear)
    : m.property;

  return [
    'case',
    m.nullCheck,
    m.nullColor,
    [
      'interpolate', ['linear'],
      ['coalesce', ['get', property], m.stops[0][0]],
      ...m.stops.flat(),
    ],
  ];
}

function updateLegend(metricKey) {
  const m = METRICS[metricKey];
  if (!m) return;

  document.getElementById('legendTitle').textContent = m.label;
  document.getElementById('legendGradient').style.background = m.legendGradient;

  const labelsEl = document.getElementById('legendLabels');
  labelsEl.innerHTML = '';
  m.legendLabels.forEach(l => {
    const span = document.createElement('span');
    span.textContent = l;
    labelsEl.appendChild(span);
  });

  const nullEl = document.getElementById('legendNull');
  if (m.nullLabel) {
    nullEl.style.display = 'flex';
    document.getElementById('legendNullLabel').textContent = m.nullLabel;
  } else {
    nullEl.style.display = 'none';
  }
}

function setMetricLayer(metricKey, year) {
  if (!METRICS[metricKey]) return;
  currentMetric = metricKey;
  if (year !== undefined) currentYear = year;

  if (map.getLayer('census-fill')) {
    map.setPaintProperty('census-fill', 'fill-color', buildFillColorExpression(metricKey, currentYear));
  }
  updateLegend(metricKey);

  const m = METRICS[metricKey];
  const sliderWrap = document.getElementById('yearSliderWrap');
  if (m.isYearAware) {
    sliderWrap.style.display = 'block';
    const slider = document.getElementById('yearSlider');
    slider.min = String(m.years[0]);
    slider.max = String(m.years[m.years.length - 1]);
    slider.value = String(currentYear);
    document.getElementById('yearLabel').textContent = `Year: ${currentYear}`;
  } else {
    sliderWrap.style.display = 'none';
  }
}

// =============================================================
// 9. ON LOAD
// =============================================================
map.on('load', async () => {

  // 9a. Lighting
  try { map.setConfigProperty('basemap', 'lightPreset', 'day'); } catch (e) {}

  // 9b. Cinematic shapes (hidden by default)
  try {
    map.addSource('charleston-cinematic', { type: 'geojson', data: CINEMATIC_PATH });

    map.addLayer({
      id: 'cinematic-mask',
      type: 'fill',
      source: 'charleston-cinematic',
      filter: ['==', ['get', 'kind'], 'inverted_mask'],
      slot: 'top',
      paint: { 'fill-color': '#000000', 'fill-opacity': 0.55 },
      layout: { visibility: 'none' },
    });

    map.addLayer({
      id: 'cinematic-boundary',
      type: 'line',
      source: 'charleston-cinematic',
      filter: ['==', ['get', 'kind'], 'greater_charleston_union'],
      slot: 'top',
      paint: { 'line-color': '#c9a84c', 'line-width': 2.5, 'line-dasharray': [4, 2] },
      layout: { visibility: 'none' },
    });
  } catch (err) { console.warn('Cinematic shapes not loaded:', err.message); }

  // 9c. Census choropleth
  try {
    map.addSource('charleston-area-tracts', {
      type: 'geojson',
      data: TRACTS_PATH,
      promoteId: 'GEOID',
    });

    map.addLayer({
      id: 'census-fill',
      type: 'fill',
      source: 'charleston-area-tracts',
      slot: 'bottom',
      paint: {
        'fill-color': buildFillColorExpression(currentMetric, currentYear),
        'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.88, 0.68],
      },
    });

    map.addLayer({
      id: 'census-outline',
      type: 'line',
      source: 'charleston-area-tracts',
      slot: 'middle',
      paint: {
        'line-color': 'rgba(255,255,255,0.65)',
        'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2.5, 0.55],
      },
    });

    console.log('Census layer loaded.');
  } catch (err) {
    console.error('Could not load Census layer:', err);
    console.log('Run execution/fetch_charleston_data.py to generate data files.');
  }

  // 9d. Place boundaries
  try {
    map.addSource('charleston-places', { type: 'geojson', data: PLACES_PATH });

    map.addLayer({
      id: 'place-fill',
      type: 'fill',
      source: 'charleston-places',
      filter: ['==', ['get', 'kind'], 'incorporated_town'],
      slot: 'middle',
      paint: { 'fill-color': '#0e4d6c', 'fill-opacity': 0.06 },
    });

    map.addLayer({
      id: 'place-outline',
      type: 'line',
      source: 'charleston-places',
      filter: ['any', ['==', ['get', 'kind'], 'incorporated_town'], ['==', ['get', 'kind'], 'cdp']],
      slot: 'top',
      paint: { 'line-color': '#0e4d6c', 'line-width': 2 },
    });

    map.addLayer({
      id: 'colloquial-points',
      type: 'circle',
      source: 'charleston-places',
      filter: ['==', ['get', 'kind'], 'colloquial'],
      slot: 'top',
      paint: {
        'circle-radius': 6,
        'circle-color': '#c9a84c',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
      },
    });

    map.addLayer({
      id: 'place-labels',
      type: 'symbol',
      source: 'charleston-places',
      slot: 'top',
      layout: {
        'text-field': ['get', 'display_name'],
        'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10, 14, 14],
        'text-offset': [0, 0.9],
        'text-anchor': 'top',
        'text-allow-overlap': false,
      },
      paint: { 'text-color': '#0e2d3e', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
    });

    console.log('Place boundaries loaded.');
  } catch (err) { console.warn('Place layer not loaded:', err.message); }

  // 9e. Landmark pins
  LANDMARKS.forEach((lm) => {
    const popup = new mapboxgl.Popup({ offset: 25, closeButton: false })
      .setHTML(`<div class="marker-popup"><h3>${lm.name}</h3><p>${lm.description}</p></div>`);
    new mapboxgl.Marker({ color: '#9e2a2b' })
      .setLngLat(lm.coordinates)
      .setPopup(popup)
      .addTo(map);
  });

  // 9f. Productivity parcel layer (hidden by default)
  try {
    map.addSource('charleston-productivity', { type: 'geojson', data: PRODUCTIVITY_PATH, promoteId: 'pid' });

    map.addLayer({
      id: 'productivity-fill',
      type: 'fill',
      source: 'charleston-productivity',
      slot: 'top',
      layout: { visibility: 'none' },
      paint: {
        'fill-color': [
          'case',
          ['!', ['has', 'tax_per_acre']],
          '#d4d4c8',
          ['interpolate', ['linear'], ['get', 'tax_per_acre'],
            ...TAX_ACRE_STOPS.flat()],
        ],
        'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.95, 0.80],
      },
    });

    map.addLayer({
      id: 'productivity-outline',
      type: 'line',
      source: 'charleston-productivity',
      slot: 'top',
      layout: { visibility: 'none' },
      paint: { 'line-color': 'rgba(255,255,255,0.5)', 'line-width': 0.4 },
    });

    console.log('Productivity layer loaded.');
  } catch (err) { console.warn('Productivity layer not loaded:', err.message); }

  // 9g. Populate metric dropdown
  const sel = document.getElementById('metricSelect');
  Object.entries(METRICS).forEach(([key, m]) => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = m.label;
    sel.appendChild(opt);
  });
  sel.value = currentMetric;
  updateLegend(currentMetric);

  console.log('Charleston map loaded.');
});

// =============================================================
// 10. HOVER STATE
// =============================================================
let hoveredTractId = null;
let hoveredParcelId = null;

map.on('mousemove', 'census-fill', (e) => {
  if (!e.features.length) return;
  map.getCanvas().style.cursor = 'pointer';
  const newId = e.features[0].id;
  if (hoveredTractId !== null && hoveredTractId !== newId) {
    map.setFeatureState({ source: 'charleston-area-tracts', id: hoveredTractId }, { hover: false });
  }
  hoveredTractId = newId;
  map.setFeatureState({ source: 'charleston-area-tracts', id: hoveredTractId }, { hover: true });
});

map.on('mouseleave', 'census-fill', () => {
  map.getCanvas().style.cursor = '';
  if (hoveredTractId !== null) {
    map.setFeatureState({ source: 'charleston-area-tracts', id: hoveredTractId }, { hover: false });
  }
  hoveredTractId = null;
});

// =============================================================
// 11. CLICK POPUP — adapts to current metric
// =============================================================
map.on('click', 'census-fill', (e) => {
  if (!e.features.length) return;
  const p = e.features[0].properties;
  const m = METRICS[currentMetric];
  const name = p.NAME || `Tract ${p.TRACT}`;
  const countyTag = p.county_name
    ? `<div class="tract-county">${p.county_name} County, SC</div>` : '';

  // Primary metric value
  const property = m.isYearAware
    ? m.propertyTemplate.replace('{year}', currentYear)
    : m.property;
  const primaryVal = p[property];
  const formatted = m.formatPopup(primaryVal);

  // Growth badge (if not already the growth metric)
  let growthBadge = '';
  if (currentMetric !== 'growth_pct' && (p.has_2010 === true || p.has_2010 === 'true')) {
    const g = parseFloat(p.growth_pct);
    const sign = g > 0 ? '+' : '';
    const cls = g >= 0 ? '' : ' negative';
    growthBadge = `<div class="tract-highlight${cls}">${g > 0 ? '▲' : '▼'} ${sign}${g.toFixed(1)}% since 2010</div>`;
  }

  // Highlight for primary metric
  const highlightClass = (currentMetric === 'growth_pct' && parseFloat(primaryVal) < 0) ? ' negative' : '';
  const highlight = `<div class="tract-highlight${highlightClass}">${m.label}: ${formatted}</div>`;

  const noteEl = p.has_2010 === false || p.has_2010 === 'false'
    ? '<div class="tract-note">New tract since 2010 — no clean 2010 comparison.</div>' : '';

  const body = `
    <div class="tract-popup">
      <h3>${name}</h3>
      ${countyTag}
      <div class="tract-stat">
        <span class="label">2020 pop</span>
        <span class="value">${p.pop_2020 != null ? Number(p.pop_2020).toLocaleString() : 'n/a'}</span>
      </div>
      ${p.median_income != null ? `<div class="tract-stat">
        <span class="label">Median income</span>
        <span class="value">$${Number(p.median_income).toLocaleString()}</span>
      </div>` : ''}
      ${p.poverty_rate != null ? `<div class="tract-stat">
        <span class="label">Poverty rate</span>
        <span class="value">${parseFloat(p.poverty_rate).toFixed(1)}%</span>
      </div>` : ''}
      ${p.median_home_value != null ? `<div class="tract-stat">
        <span class="label">Median home value</span>
        <span class="value">$${Number(p.median_home_value).toLocaleString()}</span>
      </div>` : ''}
      ${highlight}
      ${growthBadge}
      ${noteEl}
    </div>`;

  new mapboxgl.Popup({ offset: 4, maxWidth: '270px' })
    .setLngLat(e.lngLat)
    .setHTML(body)
    .addTo(map);
});

// Place clicks
['place-fill', 'place-outline', 'colloquial-points'].forEach((layerId) => {
  map.on('click', layerId, (e) => {
    if (!e.features.length) return;
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
// 11b. PRODUCTIVITY HOVER + CLICK
// =============================================================
map.on('mousemove', 'productivity-fill', (e) => {
  if (!e.features.length) return;
  map.getCanvas().style.cursor = 'pointer';
  const newId = e.features[0].id;
  if (hoveredParcelId !== null && hoveredParcelId !== newId) {
    map.setFeatureState({ source: 'charleston-productivity', id: hoveredParcelId }, { hover: false });
  }
  hoveredParcelId = newId;
  map.setFeatureState({ source: 'charleston-productivity', id: hoveredParcelId }, { hover: true });
});

map.on('mouseleave', 'productivity-fill', () => {
  map.getCanvas().style.cursor = '';
  if (hoveredParcelId !== null) {
    map.setFeatureState({ source: 'charleston-productivity', id: hoveredParcelId }, { hover: false });
  }
  hoveredParcelId = null;
});

map.on('click', 'productivity-fill', (e) => {
  if (!e.features.length) return;
  const p = e.features[0].properties;
  const tpa = p.tax_per_acre != null ? '$' + Math.round(p.tax_per_acre).toLocaleString() + '/ac' : 'n/a';
  const vpa = p.value_per_acre != null ? '$' + Math.round(p.value_per_acre).toLocaleString() + '/ac' : 'n/a';
  const appr = p.appraisal != null ? '$' + Number(p.appraisal).toLocaleString() : 'n/a';
  const tax  = p.est_tax_net != null ? '$' + Math.round(p.est_tax_net).toLocaleString() + '/yr' : 'n/a';
  const flags = [
    p.legal_residence ? '🏠 Owner-occupied' : null,
    p.is_civic_exempt ? '⛪ Civic/exempt' : null,
    p.absentee_owner ? '📮 Absentee owner' : null,
  ].filter(Boolean).join('<br>');

  new mapboxgl.Popup({ offset: 4, maxWidth: '280px' })
    .setLngLat(e.lngLat)
    .setHTML(`
      <div class="tract-popup">
        <h3>${p.address || 'Parcel'}</h3>
        <div class="tract-county">${p.area_short || ''} · ${p.use_label || ''}</div>
        <div class="tract-stat"><span class="label">Tax/acre</span><span class="value">${tpa}</span></div>
        <div class="tract-stat"><span class="label">Value/acre</span><span class="value">${vpa}</span></div>
        <div class="tract-stat"><span class="label">Appraised</span><span class="value">${appr}</span></div>
        <div class="tract-stat"><span class="label">Annual tax</span><span class="value">${tax}</span></div>
        ${flags ? `<div class="tract-note" style="margin-top:6px;">${flags}</div>` : ''}
      </div>`)
    .addTo(map);
  e.originalEvent.stopPropagation();
});

// =============================================================
// 12. window.charlestonMap — voice agent control API
// =============================================================
window.charlestonMap = {

  setMetric(metricKey) {
    const aliases = {
      'growth': 'growth_pct', 'population growth': 'growth_pct', '2010 to 2020': 'growth_pct',
      'population': 'pop_2020', 'pop': 'pop_2020', '2020 population': 'pop_2020',
      'annual population': 'pop_by_year', 'population by year': 'pop_by_year', 'year': 'pop_by_year',
      'income': 'median_income', 'household income': 'median_income', 'wealth': 'median_income',
      'age': 'median_age', 'median age': 'median_age',
      'diversity': 'pct_nonwhite', 'non-white': 'pct_nonwhite', 'race': 'pct_nonwhite',
      'poverty': 'poverty_rate', 'poor': 'poverty_rate',
      'home value': 'median_home_value', 'home values': 'median_home_value',
      'housing value': 'median_home_value', 'property value': 'median_home_value',
      'rent': 'median_gross_rent', 'rents': 'median_gross_rent', 'rental': 'median_gross_rent',
      'owners': 'owner_occ_rate', 'ownership': 'owner_occ_rate', 'owner occupancy': 'owner_occ_rate',
      'vacancy': 'vacancy_rate', 'vacant': 'vacancy_rate',
      'single family': 'pct_single_family', 'single-family': 'pct_single_family', 'housing type': 'pct_single_family',
      'year built': 'median_year_built', 'housing age': 'median_year_built', 'age of housing': 'median_year_built',
      'education': 'pct_bachelors_plus', 'college': 'pct_bachelors_plus',
      'bachelors': 'pct_bachelors_plus', 'degree': 'pct_bachelors_plus',
      'unemployment': 'unemployment_rate', 'jobs': 'unemployment_rate',
      'work from home': 'pct_wfh', 'remote work': 'pct_wfh', 'wfh': 'pct_wfh',
    };
    const key = aliases[String(metricKey).toLowerCase()] || metricKey;
    if (!METRICS[key]) return { success: false, error: `Unknown metric: "${metricKey}". Available: ${Object.keys(METRICS).join(', ')}.` };
    setMetricLayer(key);
    document.getElementById('metricSelect').value = key;
    return { success: true, metric: key, label: METRICS[key].label };
  },

  flyToPlace(name) {
    if (!name) return { success: false, error: 'Need a place name.' };
    const n = String(name).toLowerCase().trim();
    const target = FLY_TARGETS[n] || Object.entries(FLY_TARGETS).find(([k]) => k.includes(n) || n.includes(k))?.[1];
    if (!target) return { success: false, error: `Unknown place: "${name}". Try: ${Object.values(FLY_TARGETS).map(t => t.label).slice(0,5).join(', ')}, ...` };
    map.flyTo({ center: target.center, zoom: target.zoom, pitch: target.pitch ?? 40, bearing: target.bearing ?? 0, duration: 2200, essential: true });
    return { success: true, flew_to: target.label };
  },

  resetView() {
    map.flyTo({ center: CHARLESTON_CENTER, zoom: DEFAULT_ZOOM, pitch: DEFAULT_PITCH, bearing: DEFAULT_BEARING, duration: 2000, essential: true });
    return { success: true };
  },

  fitGreaterCharleston() {
    map.fitBounds(GREATER_CHARLESTON_BOUNDS, { padding: 40, duration: 2000, pitch: 25, bearing: 0 });
    return { success: true, area: 'Greater Charleston tri-county metro' };
  },

  setCinematic(on) {
    const vis = on ? 'visible' : 'none';
    if (map.getLayer('cinematic-mask'))    map.setLayoutProperty('cinematic-mask', 'visibility', vis);
    if (map.getLayer('cinematic-boundary')) map.setLayoutProperty('cinematic-boundary', 'visibility', vis);
    if (on) { map.fitBounds(GREATER_CHARLESTON_BOUNDS, { padding: 60, duration: 2400, pitch: 40, bearing: 0 }); }
    return { success: true, cinematic: on };
  },

  setYear(year) {
    const y = parseInt(year);
    if (isNaN(y) || y < 2014 || y > 2024) return { success: false, error: 'Year must be 2014–2024.' };
    currentYear = y;
    if (METRICS[currentMetric]?.isYearAware) {
      setMetricLayer(currentMetric, y);
    } else {
      setMetricLayer('pop_by_year', y);
      document.getElementById('metricSelect').value = 'pop_by_year';
    }
    return { success: true, year: y };
  },

  toggleCinematic() {
    cinematicOn = !cinematicOn;
    const vis = cinematicOn ? 'visible' : 'none';
    if (map.getLayer('cinematic-mask'))     map.setLayoutProperty('cinematic-mask', 'visibility', vis);
    if (map.getLayer('cinematic-boundary')) map.setLayoutProperty('cinematic-boundary', 'visibility', vis);
    if (cinematicOn) { map.fitBounds(GREATER_CHARLESTON_BOUNDS, { padding: 60, duration: 2400, pitch: 40, bearing: 0 }); }
    const btn = document.getElementById('toggleCinematic');
    if (btn) { btn.textContent = cinematicOn ? 'Exit Cinematic' : 'Cinematic'; btn.style.background = cinematicOn ? '#c9a84c' : ''; btn.style.color = cinematicOn ? '#000' : ''; }
    return { success: true, cinematic: cinematicOn };
  },

  togglePlaces() {
    placesVisible = !placesVisible;
    const vis = placesVisible ? 'visible' : 'none';
    ['place-fill', 'place-outline', 'colloquial-points', 'place-labels'].forEach(id => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
    });
    const btn = document.getElementById('togglePlaces');
    if (btn) btn.textContent = placesVisible ? 'Hide Places' : 'Show Places';
    return { success: true, places_visible: placesVisible };
  },

  toggleCensus() {
    censusVisible = !censusVisible;
    const vis = censusVisible ? 'visible' : 'none';
    ['census-fill', 'census-outline'].forEach(id => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis); });
    document.getElementById('legend').classList.toggle('hidden', !censusVisible);
    const btn = document.getElementById('toggleCensus');
    if (btn) btn.textContent = censusVisible ? 'Hide Census' : 'Show Census';
    return { success: true, census_visible: censusVisible };
  },

  toggle3D() {
    in3DMode = !in3DMode;
    map.easeTo({ pitch: in3DMode ? DEFAULT_PITCH : 0, bearing: 0, duration: 1200 });
    const btn = document.getElementById('toggle3D');
    if (btn) btn.textContent = in3DMode ? 'Toggle 3D' : 'Toggle 2D';
    return { success: true, mode_3d: in3DMode };
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
      map.flyTo({ center: [-79.9399, 32.7750], zoom: 14.5, pitch: 45, bearing: 10, duration: 2000, essential: true });
    }
    return { success: true, productivity_visible: productivityVisible };
  },
};

// =============================================================
// 13. BUTTON HANDLERS
// =============================================================
document.getElementById('resetView').addEventListener('click', () => {
  window.charlestonMap.resetView();
});

// State for toggle methods (referenced by window.charlestonMap toggle* methods above)
let in3DMode          = true;
let censusVisible     = true;
let placesVisible     = true;
let cinematicOn       = false;
let productivityVisible = false;

document.getElementById('toggle3D').addEventListener('click', () => window.charlestonMap.toggle3D());

const LIGHT_PRESETS = ['day', 'dusk', 'dawn', 'night'];
let lightIndex = 0;
document.getElementById('cycleLight').addEventListener('click', (e) => {
  lightIndex = (lightIndex + 1) % LIGHT_PRESETS.length;
  const preset = LIGHT_PRESETS[lightIndex];
  try { map.setConfigProperty('basemap', 'lightPreset', preset); } catch {}
  e.target.textContent = `Lighting: ${preset}`;
});

document.getElementById('toggleCensus').addEventListener('click', () => window.charlestonMap.toggleCensus());
document.getElementById('togglePlaces').addEventListener('click', () => window.charlestonMap.togglePlaces());
document.getElementById('toggleCinematic').addEventListener('click', () => window.charlestonMap.toggleCinematic());
document.getElementById('toggleProductivity').addEventListener('click', () => window.charlestonMap.toggleProductivity());

// Metric dropdown
document.getElementById('metricSelect').addEventListener('change', (e) => {
  setMetricLayer(e.target.value);
});

// Year slider
document.getElementById('yearSlider').addEventListener('input', (e) => {
  currentYear = parseInt(e.target.value);
  document.getElementById('yearLabel').textContent = `Year: ${currentYear}`;
  if (map.getLayer('census-fill')) {
    map.setPaintProperty('census-fill', 'fill-color', buildFillColorExpression(currentMetric, currentYear));
  }
});

// =============================================================
// 14. ERROR HANDLER
// =============================================================
map.on('error', (err) => {
  if (String(mapboxgl.accessToken).startsWith('PASTE')) {
    document.body.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100vh;
                  font-family:system-ui;background:#0a0e14;color:#f5f0e8;padding:24px;text-align:center;">
        <div style="max-width:480px;">
          <h1 style="font-family:'Libre Baskerville',serif;font-size:28px;margin-bottom:12px;">Almost there</h1>
          <p style="line-height:1.5;color:#aaa;">
            Open <code style="background:#222;padding:2px 6px;border-radius:3px;">map.js</code>
            and paste your Mapbox token at the top.
          </p>
        </div>
      </div>`;
  } else {
    console.error('Mapbox error:', err);
  }
});
