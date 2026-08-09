import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, MapGeoJSONFeature } from 'maplibre-gl';

type FeatureCollection = GeoJSON.FeatureCollection<GeoJSON.Geometry, Record<string, any>>;
type GridFeature = GeoJSON.Feature<GeoJSON.Polygon, Record<string, any>>;

const app = document.querySelector<HTMLElement>('#strategy-app');
if (!app) throw new Error('Location strategy app root is missing.');

const dataBase = `${app.dataset.base ?? '/'}data/`;
const status = document.querySelector<HTMLElement>('#model-status')!;
const surfaceSelect = document.querySelector<HTMLSelectElement>('#surface-select')!;
const insight = document.querySelector<HTMLElement>('#cell-insight')!;
const emptyInsight = document.querySelector<HTMLElement>('#empty-insight')!;

const DEFAULT_COMPONENT_WEIGHTS = {
  drive_demand_score: 30,
  competitive_whitespace_score: 20,
  destination_character_score: 15,
  affluence_score: 15,
  road_access_score: 10,
  school_score: 5,
  development_score: 5,
};
const COMPONENT_LABELS: Record<string, string> = {
  drive_demand_score: 'Drive-time family demand',
  competitive_whitespace_score: 'Competitive whitespace',
  destination_character_score: 'Destination character',
  affluence_score: 'Affluence',
  road_access_score: 'Road accessibility',
  school_score: 'School / education demand',
  development_score: 'Development favorability',
};
const SURFACE_LABELS: Record<string, string> = {
  opportunity_score: 'Overall opportunity',
  ...COMPONENT_LABELS,
};
const DEFAULT_DRIVE_WEIGHTS = { family_demand_15: 1, family_demand_30: 0.7, family_demand_45: 0.35 };
const DRIVE_LABELS: Record<string, string> = {
  family_demand_15: '0–15 minutes',
  family_demand_30: '15–30 minutes',
  family_demand_45: '30–45 minutes',
};
const STUDY_BOUNDS: maplibregl.LngLatBoundsLike = [[-84.18, 41.8], [-82.78, 42.88]];
const SCORE_COLORS = ['#7a3432', '#d28543', '#e6ce83', '#8ba779', '#2f5a43'];

const componentWeights = { ...DEFAULT_COMPONENT_WEIGHTS };
const driveWeights = { ...DEFAULT_DRIVE_WEIGHTS };
let competition5Reach = 32;
let competition4Reach = 26;
let gridData: FeatureCollection | null = null;
let selectedCellId: string | null = null;
let metadata: Record<string, any> | null = null;
const loadedReferences = new Set<string>();

// The worker file is staged into public/vendor/maplibre by the prebuild
// script; without this override the bundled library 404s on its worker and
// the map silently never renders.
maplibregl.setWorkerUrl(`${app.dataset.base ?? '/'}vendor/maplibre/maplibre-gl-worker.mjs`);

const POSITRON_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';

/** OpenFreeMap Positron compares admin_level with >=/<=; null features spam the console. */
function sanitizeBasemapStyle(style: maplibregl.StyleSpecification): maplibregl.StyleSpecification {
  for (const layer of style.layers ?? []) {
    if (layer.id !== 'boundary_3' || !('filter' in layer)) continue;
    layer.filter = [
      'all',
      ['match', ['get', 'admin_level'], [3, 4, 5, 6], true, false],
      ['!=', ['get', 'maritime'], 1],
      ['!=', ['get', 'disputed'], 1],
      ['!', ['has', 'claimed_by']],
    ];
  }
  return style;
}

const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    sources: {},
    layers: [{
      id: 'background',
      type: 'background',
      paint: { 'background-color': '#e8e2d5' },
    }],
  },
  center: [-83.55, 42.35],
  zoom: 8.35,
  minZoom: 6.5,
  maxZoom: 15,
  attributionControl: false,
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
map.addControl(
  new maplibregl.AttributionControl({
    compact: true,
    customAttribution: 'Analysis: Leaf & Lantern · Travel times are modeled approximations',
  }),
  'bottom-right',
);

async function loadBasemapStyle(): Promise<void> {
  const applyStyle = (style: string | maplibregl.StyleSpecification) => new Promise<void>((resolve) => {
    map.once('style.load', () => resolve());
    map.setStyle(style);
  });

  try {
    const response = await fetch(POSITRON_STYLE_URL);
    if (!response.ok) throw new Error(`Basemap style HTTP ${response.status}`);
    await applyStyle(sanitizeBasemapStyle(await response.json()));
  } catch (error) {
    console.warn('Falling back to remote Positron style URL', error);
    await applyStyle(POSITRON_STYLE_URL);
  }
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function score(value: unknown): number {
  return Math.max(0, Math.min(100, number(value)));
}

function quantileScores(values: number[]): number[] {
  const sorted = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const output = new Array(values.length).fill(50);
  sorted.forEach((item, rank) => {
    output[item.index] = sorted.length > 1 ? (rank / (sorted.length - 1)) * 100 : 50;
  });
  return output;
}

function competitorPressure(feature: GridFeature): number {
  const travelTimes = feature.properties.competitor_travel_times ?? [];
  return travelTimes.reduce((total: number, item: Record<string, any>) => {
    const minutes = number(item.minutes);
    const direct = number(item.score);
    if (!minutes) return total;
    let effect = 0;
    if (direct === 5) effect = Math.max(0, 1 - minutes / competition5Reach) ** 1.35;
    else if (direct === 4) effect = Math.max(0, 1 - minutes / competition4Reach) ** 1.5;
    else if (direct === 3) effect = 0.35 * Math.max(0, 1 - minutes / 22);
    else effect = 0.15 * Math.max(0, 1 - minutes / 18);
    return total + effect * (direct / 5);
  }, 0);
}

function recomputeModel(): void {
  if (!gridData) return;
  const features = gridData.features as GridFeature[];
  const demandRaw = features.map((feature) => (
    number(feature.properties.family_demand_15) * driveWeights.family_demand_15
    + number(feature.properties.family_demand_30) * driveWeights.family_demand_30
    + number(feature.properties.family_demand_45) * driveWeights.family_demand_45
  ));
  const pressureRaw = features.map(competitorPressure);
  const demandScores = quantileScores(demandRaw);
  const pressureScores = quantileScores(pressureRaw).map((value) => 100 - value);
  const totalWeight = Object.values(componentWeights).reduce((sum, value) => sum + value, 0) || 1;

  features.forEach((feature, index) => {
    feature.properties.drive_demand_score = demandScores[index];
    feature.properties.competitor_pressure_raw = pressureRaw[index];
    feature.properties.competitive_whitespace_score = pressureScores[index];
    feature.properties.destination_character_score = (
      score(feature.properties.open_context_score) * 0.55
      + demandScores[index] * 0.45
    );
    feature.properties.opportunity_score = Object.entries(componentWeights).reduce(
      (sum, [key, weight]) => sum + score(feature.properties[key]) * weight / totalWeight,
      0,
    );
  });
  (map.getSource('opportunity') as GeoJSONSource | undefined)?.setData(gridData);
  updateSurface();
  if (selectedCellId) {
    const selected = features.find((feature) => feature.properties.cell_id === selectedCellId);
    if (selected) renderInsight(selected.properties);
  }
}

function updateSurface(): void {
  if (!map.getLayer('opportunity-fill')) return;
  const property = surfaceSelect.value;
  map.setPaintProperty('opportunity-fill', 'fill-color', [
    'interpolate', ['linear'], ['coalesce', ['get', property], 0],
    0, SCORE_COLORS[0], 25, SCORE_COLORS[1], 50, SCORE_COLORS[2],
    75, SCORE_COLORS[3], 100, SCORE_COLORS[4],
  ]);
}

function sliderMarkup(
  values: Record<string, number>,
  labels: Record<string, string>,
  kind: 'component' | 'drive',
): string {
  return Object.entries(values).map(([key, value]) => `
    <label>
      <span><b>${escapeHtml(labels[key])}</b> <output data-output="${key}">${kind === 'component' ? value : value.toFixed(2)}${kind === 'component' ? '%' : '×'}</output></span>
      <input type="range" data-${kind}="${key}" min="0" max="${kind === 'component' ? 50 : 1.5}" value="${value}" step="${kind === 'component' ? 1 : 0.05}" />
    </label>
  `).join('');
}

function setupControls(): void {
  document.querySelector('#component-weights')!.innerHTML = sliderMarkup(
    componentWeights, COMPONENT_LABELS, 'component',
  );
  document.querySelector('#drive-weights')!.innerHTML = sliderMarkup(
    driveWeights, DRIVE_LABELS, 'drive',
  );
  document.querySelectorAll<HTMLInputElement>('[data-component]').forEach((input) => {
    input.addEventListener('input', () => {
      componentWeights[input.dataset.component as keyof typeof componentWeights] = number(input.value);
      const output = document.querySelector<HTMLOutputElement>(`[data-output="${input.dataset.component}"]`);
      if (output) output.value = `${input.value}%`;
      recomputeModel();
    });
  });
  document.querySelectorAll<HTMLInputElement>('[data-drive]').forEach((input) => {
    input.addEventListener('input', () => {
      driveWeights[input.dataset.drive as keyof typeof driveWeights] = number(input.value);
      const output = document.querySelector<HTMLOutputElement>(`[data-output="${input.dataset.drive}"]`);
      if (output) output.value = `${number(input.value).toFixed(2)}×`;
      recomputeModel();
    });
  });
  document.querySelector('#reset-weights')?.addEventListener('click', () => {
    Object.assign(componentWeights, DEFAULT_COMPONENT_WEIGHTS);
    Object.assign(driveWeights, DEFAULT_DRIVE_WEIGHTS);
    setupControls();
    recomputeModel();
  });
}

function scoreBand(value: number): string {
  if (value >= 80) return 'Very strong';
  if (value >= 65) return 'Strong';
  if (value >= 45) return 'Mixed';
  if (value >= 25) return 'Weak';
  return 'Very weak';
}

function reasonText(properties: Record<string, any>): string {
  const components = Object.keys(COMPONENT_LABELS)
    .map((key) => ({ key, value: score(properties[key]) }))
    .sort((a, b) => b.value - a.value);
  const strongest = components.slice(0, 2).map((item) => COMPONENT_LABELS[item.key].toLowerCase());
  const weakest = components.at(-1)!;
  return `This cell is strongest on ${strongest.join(' and ')}. Its main constraint is ${COMPONENT_LABELS[weakest.key].toLowerCase()}.`;
}

function scoreRows(properties: Record<string, any>): string {
  return Object.entries(COMPONENT_LABELS).map(([key, label]) => {
    const value = Math.round(score(properties[key]));
    return `
      <div class="score-row">
        <div><span>${escapeHtml(label)}</span><b>${value}</b></div>
        <div class="score-track"><i style="width:${value}%"></i></div>
      </div>
    `;
  }).join('');
}

function renderInsight(properties: Record<string, any>): void {
  emptyInsight.hidden = true;
  insight.hidden = false;
  const overall = Math.round(score(properties.opportunity_score));
  const competitors = (properties.nearest_competitors ?? []).slice(0, 3);
  const basins = (properties.basin_travel_times ?? [])
    .filter((item: Record<string, any>) => number(item.minutes) <= 45)
    .sort((a: Record<string, any>, b: Record<string, any>) => number(a.minutes) - number(b.minutes))
    .slice(0, 6);
  insight.innerHTML = `
    <span class="insight-kicker">Selected search cell</span>
    <div class="overall-score">
      <div><strong>${overall}</strong><span>/ 100</span></div>
      <div><b>${scoreBand(overall)}</b><span>relative regional fit</span></div>
    </div>
    <p class="reason">${escapeHtml(reasonText(properties))}</p>
    <section class="insight-section">
      <h3>Component scores</h3>
      ${scoreRows(properties)}
    </section>
    <section class="insight-section">
      <h3>Family market by modeled drive time</h3>
      <div class="market-bands">
        <div><b>${Math.round(number(properties.households_15)).toLocaleString()}</b><span>0–15 min households</span></div>
        <div><b>${Math.round(number(properties.households_30)).toLocaleString()}</b><span>15–30 min incremental</span></div>
        <div><b>${Math.round(number(properties.households_45)).toLocaleString()}</b><span>30–45 min incremental</span></div>
      </div>
    </section>
    <section class="insight-section">
      <h3>Customer basins within 45 modeled minutes</h3>
      <ul class="detail-list">
        ${basins.length ? basins.map((item: Record<string, any>) => `<li><span>${escapeHtml(item.name)}</span><b>${Math.round(number(item.minutes))} min</b></li>`).join('') : '<li>No modeled basin center within 45 minutes</li>'}
      </ul>
    </section>
    <section class="insight-section">
      <h3>Highest competitor pressure</h3>
      <ul class="detail-list">
        ${competitors.length ? competitors.map((item: Record<string, any>) => `<li><span>${escapeHtml(item.name)}</span><b>${Math.round(number(item.minutes))} min</b></li>`).join('') : '<li>No material pressure in the modeled range</li>'}
      </ul>
    </section>
    <p class="screening-note">Cell-level screening only. Inspect wetlands, flood risk, access, utilities, zoning, and buildability again at parcel scale.</p>
  `;
}

async function fetchGeoJson(filename: string): Promise<FeatureCollection> {
  const response = await fetch(`${dataBase}${filename}`);
  if (!response.ok) throw new Error(`Could not load ${filename}`);
  return response.json();
}

function addGridLayer(): void {
  if (!gridData) return;
  map.addSource('opportunity', { type: 'geojson', data: gridData });
  map.addLayer({
    id: 'opportunity-fill',
    type: 'fill',
    source: 'opportunity',
    paint: {
      'fill-color': '#d8c39b',
      'fill-opacity': 0.7,
      'fill-outline-color': 'rgba(255,255,255,0.14)',
    },
  });
  map.addLayer({
    id: 'opportunity-selected',
    type: 'line',
    source: 'opportunity',
    filter: ['==', ['get', 'cell_id'], ''],
    paint: { 'line-color': '#171d18', 'line-width': 3 },
  });
  updateSurface();
  map.on('mousemove', 'opportunity-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'opportunity-fill', () => { map.getCanvas().style.cursor = ''; });
  map.on('click', 'opportunity-fill', (event) => {
    const feature = event.features?.[0] as MapGeoJSONFeature | undefined;
    if (!feature) return;
    selectedCellId = String(feature.properties.cell_id);
    map.setFilter('opportunity-selected', ['==', ['get', 'cell_id'], selectedCellId]);
    const sourceFeature = (gridData!.features as GridFeature[])
      .find((item) => item.properties.cell_id === selectedCellId);
    if (sourceFeature) renderInsight(sourceFeature.properties);
  });
}

function addCompetitors(data: FeatureCollection): void {
  map.addSource('competitors', { type: 'geojson', data });
  map.addLayer({
    id: 'competitors',
    type: 'circle',
    source: 'competitors',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['get', 'direct_competition_score'], 1, 4, 5, 10],
      'circle-color': ['match', ['get', 'direct_competition_score'], 5, '#7a3432', 4, '#a8652a', 3, '#c89555', '#d8c39b'],
      'circle-stroke-color': '#fffdf8',
      'circle-stroke-width': 1.5,
      'circle-opacity': 0.95,
    },
  });
  map.on('click', 'competitors', (event) => {
    const feature = event.features?.[0];
    if (!feature) return;
    const properties = feature.properties;
    const coordinates = (feature.geometry as GeoJSON.Point).coordinates.slice() as [number, number];
    // Nested feature properties arrive JSON-encoded from MapLibre.
    let sources: string[] = [];
    try {
      const parsed = JSON.parse(properties.source);
      sources = Array.isArray(parsed) ? parsed : [String(parsed)];
    } catch {
      if (properties.source) sources = [String(properties.source)];
    }
    const sourceLinks = sources
      .filter((url) => url.startsWith('http'))
      .map((url, index) => `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">Source ${index + 1}</a>`)
      .join(' · ');
    new maplibregl.Popup({ offset: 12, maxWidth: '330px' })
      .setLngLat(coordinates)
      .setHTML(`
        <div class="competitor-popup">
          <span>Competition score ${escapeHtml(properties.direct_competition_score)} / 5</span>
          <h3>${escapeHtml(properties.name)}</h3>
          <p>${escapeHtml(properties.address)}</p>
          <p>${escapeHtml(properties.notes)}</p>
          ${sourceLinks}
        </div>
      `)
      .addTo(map);
  });
}

const referenceConfig: Record<string, {
  file: string;
  source: string;
  layers: maplibregl.LayerSpecification[];
}> = {
  demographics: {
    file: 'demographics.geojson', source: 'demographics',
    layers: [{
      id: 'demographics', type: 'fill', source: 'demographics',
      paint: {
        'fill-color': ['interpolate', ['linear'], ['coalesce', ['get', 'population_density'], 0], 0, '#fff7e7', 1000, '#e5bb78', 4000, '#8e412f'],
        'fill-opacity': 0.67, 'fill-outline-color': 'rgba(60,55,45,.2)',
      },
    }],
  },
  family: {
    file: 'demographics.geojson', source: 'demographics',
    layers: [{
      id: 'family', type: 'fill', source: 'demographics',
      paint: {
        'fill-color': ['interpolate', ['linear'], ['coalesce', ['get', 'family_index'], 0], 0, '#f5eee0', 50, '#d4a95c', 100, '#4d6e52'],
        'fill-opacity': 0.7, 'fill-outline-color': 'rgba(60,55,45,.2)',
      },
    }],
  },
  income: {
    file: 'demographics.geojson', source: 'demographics',
    layers: [{
      id: 'income', type: 'fill', source: 'demographics',
      paint: {
        'fill-color': ['interpolate', ['linear'], ['coalesce', ['get', 'median_income'], 0], 30000, '#f2e8d7', 100000, '#91ad83', 180000, '#24463a'],
        'fill-opacity': 0.72, 'fill-outline-color': 'rgba(60,55,45,.2)',
      },
    }],
  },
  schools: {
    file: 'schools.geojson', source: 'schools',
    layers: [{
      id: 'schools', type: 'circle', source: 'schools',
      paint: { 'circle-radius': 3, 'circle-color': '#426b88', 'circle-opacity': 0.75, 'circle-stroke-width': 0.5, 'circle-stroke-color': '#fff' },
    }],
  },
  municipalities: {
    file: 'municipalities.geojson', source: 'municipalities',
    layers: [{ id: 'municipalities', type: 'line', source: 'municipalities', paint: { 'line-color': '#353936', 'line-width': 1, 'line-dasharray': [3, 2], 'line-opacity': 0.7 } }],
  },
  protected: {
    file: 'protected.geojson', source: 'protected',
    layers: [
      {
        id: 'protected',
        type: 'fill',
        source: 'protected',
        paint: { 'fill-color': '#2f5a43', 'fill-opacity': 0.38, 'fill-outline-color': '#243c34' },
      },
      {
        id: 'protected-outline',
        type: 'line',
        source: 'protected',
        paint: { 'line-color': '#243c34', 'line-width': 1.2, 'line-opacity': 0.85 },
      },
    ],
  },
};

/** Study-area image for wetlands — EGLE export tiles are too slow for XYZ and time out in the browser. */
const WETLANDS_OVERLAY = {
  west: -84.18,
  south: 41.8,
  east: -82.78,
  north: 42.88,
  file: 'wetlands-overlay.png',
  opacity: 0.58,
};

const rasterReferenceConfig: Record<string, { url: string; opacity: number; minzoom?: number; attribution: string }> = {
  traffic: {
    url: 'https://mdotgis.state.mi.us/arcgis/rest/services/DataAccess/MdotAadtCaadt/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&dpi=96&format=png32&transparent=true&layers=show:0,1,12&f=image',
    opacity: 0.82,
    attribution: 'MDOT',
  },
  flood: {
    // FEMA moved NFHL from /gis/nfhl/ to /arcgis/; SFHA polygons draw only when zoomed in.
    url: 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&dpi=96&format=png32&transparent=true&layers=show:28&f=image',
    opacity: 0.55,
    minzoom: 11,
    attribution: 'FEMA NFHL',
  },
};

async function toggleReference(key: string, visible: boolean): Promise<void> {
  if (key === 'competitors') {
    if (map.getLayer('competitors')) map.setLayoutProperty('competitors', 'visibility', visible ? 'visible' : 'none');
    return;
  }
  if (key === 'pressure') {
    surfaceSelect.value = visible ? 'competitive_whitespace_score' : surfaceSelect.value;
    if (visible) updateSurface();
    return;
  }
  if (key === 'wetlands') {
    if (!map.getSource('wetlands')) {
      try {
        map.addSource('wetlands', {
          type: 'image',
          url: `${dataBase}${WETLANDS_OVERLAY.file}`,
          coordinates: [
            [WETLANDS_OVERLAY.west, WETLANDS_OVERLAY.north],
            [WETLANDS_OVERLAY.east, WETLANDS_OVERLAY.north],
            [WETLANDS_OVERLAY.east, WETLANDS_OVERLAY.south],
            [WETLANDS_OVERLAY.west, WETLANDS_OVERLAY.south],
          ],
        });
        map.addLayer({
          id: 'wetlands',
          type: 'raster',
          source: 'wetlands',
          paint: { 'raster-opacity': WETLANDS_OVERLAY.opacity },
        });
      } catch {
        status.textContent = 'Wetlands layer unavailable';
        const input = document.querySelector<HTMLInputElement>('[data-layer="wetlands"]');
        if (input) input.checked = false;
        return;
      }
    }
    if (map.getLayer('wetlands')) {
      map.setLayoutProperty('wetlands', 'visibility', visible ? 'visible' : 'none');
    }
    return;
  }
  const raster = rasterReferenceConfig[key];
  if (raster) {
    if (!map.getSource(key)) {
      map.addSource(key, {
        type: 'raster',
        tiles: [raster.url],
        tileSize: 256,
        attribution: raster.attribution,
      });
      map.addLayer({
        id: key,
        type: 'raster',
        source: key,
        ...(raster.minzoom != null ? { minzoom: raster.minzoom } : {}),
        paint: { 'raster-opacity': raster.opacity },
      });
    }
    map.setLayoutProperty(key, 'visibility', visible ? 'visible' : 'none');
    if (key === 'flood' && visible && map.getZoom() < 11) {
      status.textContent = 'Zoom in to see FEMA flood zones';
    }
    return;
  }
  const config = referenceConfig[key];
  if (!config) return;
  if (!loadedReferences.has(key)) {
    try {
      if (!map.getSource(config.source)) {
        const data = await fetchGeoJson(config.file);
        map.addSource(config.source, { type: 'geojson', data });
      }
      config.layers.forEach((layer) => {
        if (!map.getLayer(layer.id)) map.addLayer(layer);
      });
      loadedReferences.add(key);
    } catch {
      status.textContent = `${key} layer unavailable`;
      const input = document.querySelector<HTMLInputElement>(`[data-layer="${key}"]`);
      if (input) input.checked = false;
      return;
    }
  }
  config.layers.forEach((layer) => {
    map.setLayoutProperty(layer.id, 'visibility', visible ? 'visible' : 'none');
  });
}

function renderMethod(): void {
  const content = document.querySelector<HTMLElement>('#method-content')!;
  content.innerHTML = `
    <p><strong>Study area.</strong> The model scores a broad southeast Michigan region without privileging the initial Plymouth–Northville–Salem hypothesis.</p>
    <h3>Core sources</h3>
    <ul>
      <li>2024 American Community Survey five-year estimates and Census cartographic tract boundaries.</li>
      <li>Travel times are calibrated approximations (distance × regional circuity, speed rising with trip length), not routed drives; market totals use tract representative points.</li>
      <li>NCES EDGE 2024–25 public school locations.</li>
      <li>MDOT 2025 AADT traffic counts (live), EGLE wetlands screening overlay, FEMA NFHL flood zones (live; closer zoom), and Michigan DNR park boundaries.</li>
      <li>SEMCOG community boundaries.</li>
      <li>Competitor attributes verified against linked official or primary sources.</li>
    </ul>
    <h3>Important limits</h3>
    <ul>${(metadata?.limitations ?? []).map((item: string) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
    <p><strong>Not scored:</strong> sewer/water service boundaries are not consistently available as a regional public layer. Their absence is shown as uncertainty, not assumed favorability.</p>
    <p class="source-date">Dataset build: ${escapeHtml(metadata?.generated_at ?? 'unknown')} · ${escapeHtml(metadata?.grid_system ?? '')}</p>
  `;
}

// Data, controls, and the method dialog must never depend on map readiness:
// if WebGL is unavailable the analysis panels still work.
const dataReady = (async () => {
  [gridData, metadata] = await Promise.all([
    fetchGeoJson('opportunity-grid.geojson'),
    fetch(`${dataBase}location-metadata.json`).then((response) => response.json()),
  ]);
  const competitors = await fetchGeoJson('competitors.geojson');
  recomputeModel();
  status.textContent = `${gridData.features.length.toLocaleString()} cells · ${metadata.acs_vintage}`;
  renderMethod();
  return competitors;
})();

document.querySelectorAll<HTMLButtonElement>('.control-tab').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.control-tab').forEach((item) => item.classList.remove('active'));
    document.querySelectorAll('.control-section').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    document.querySelector(`[data-panel="${button.dataset.tab}"]`)?.classList.add('active');
  });
});
surfaceSelect.addEventListener('change', updateSurface);
document.querySelectorAll<HTMLInputElement>('[data-layer]').forEach((input) => {
  input.addEventListener('change', () => void toggleReference(input.dataset.layer!, input.checked));
});
document.querySelector('#reset-view')?.addEventListener('click', () => map.fitBounds(STUDY_BOUNDS, { padding: 30 }));
document.querySelector('#locate-top')?.addEventListener('click', () => {
  if (!gridData) return;
  const strongest = [...(gridData.features as GridFeature[])]
    .sort((a, b) => number(b.properties.opportunity_score) - number(a.properties.opportunity_score))
    .slice(0, 40);
  const coordinates = strongest.flatMap((feature) => feature.geometry.coordinates[0]);
  const bounds = coordinates.reduce(
    (result, coordinate) => result.extend(coordinate as [number, number]),
    new maplibregl.LngLatBounds(coordinates[0] as [number, number], coordinates[0] as [number, number]),
  );
  map.fitBounds(bounds, { padding: 90, maxZoom: 10.5 });
});

const competition5 = document.querySelector<HTMLInputElement>('#competition-5')!;
const competition4 = document.querySelector<HTMLInputElement>('#competition-4')!;
competition5.addEventListener('input', () => {
  competition5Reach = number(competition5.value);
  document.querySelector<HTMLOutputElement>('#competition-5-output')!.value = `${competition5Reach} min`;
  recomputeModel();
});
competition4.addEventListener('input', () => {
  competition4Reach = number(competition4.value);
  document.querySelector<HTMLOutputElement>('#competition-4-output')!.value = `${competition4Reach} min`;
  recomputeModel();
});

const dialog = document.querySelector<HTMLDialogElement>('#method-dialog')!;
document.querySelector('#method-button')?.addEventListener('click', () => dialog.showModal());

setupControls();
dataReady.catch((error) => {
  console.error(error);
  status.textContent = 'Model data failed to load';
});

void (async () => {
  await loadBasemapStyle();
  map.fitBounds(STUDY_BOUNDS, { padding: 25, duration: 0 });
  try {
    const competitors = await dataReady;
    addGridLayer();
    addCompetitors(competitors);
  } catch {
    /* already reported above */
  }
})();
