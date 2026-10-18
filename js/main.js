import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SOURCES, pickZoom, fetchMosaic, lngLatToWorld, worldToLngLat, bboxSizeMeters, rectAround, squareAround, rectFromLngLat, canvasToFrame } from './geo.js';
import * as DEM from './dem.js';
import { makeSurface, makeRockTexture, makeCausticTexture, makeShadowTexture, WALL_THEMES, drawBoundaries, tintedTheme } from './textures.js';
import { buildDiorama } from './diorama.js';
import { prepareLocator, drawLocator, drawBackground, drawTitle, drawDescriptor, drawScaleBar, prepareGlobe, drawGlobe, setOverlayTheme, prepareSideLocator, drawSideLocator } from './overlay.js';
import { fetchFeatures, fetchGeometry, fetchAdminSamples } from './osm.js';
import { fetchTileData } from './vtiles.js';
import { buildCompass } from './compass.js';
import { parseFiles, flatten, makeLayer, projectLayers, drawDraped, buildRaised, layersGeoJSON } from './overlays.js';
import { buildLabels, geometryTargets } from './labels.js';
import { parsePins, buildPins, PIN_STYLES, MAX_PINS, MAX_PIN_LABELS } from './pins.js';
import { loadPinImage } from './pinimage.js';

const $ = (id) => document.getElementById(id);

// Presets.
const PRESETS = [
  { name: 'Straits of Mackinac, Michigan', lng: -84.72, lat: 45.84, km: 44, view: 315, title: 'The Straits of Mackinac', synth: 60, theme: 'limestone', labels: { n: 'Michigan Basin  ·  Silurian', w: 'Michigan Basin  ·  Devonian' } },
  { name: 'Puget Sound, Washington', lng: -122.7, lat: 47.65, km: 200, view: 315, title: 'Puget Sound   Washington', theme: 'sandstone', labels: { n: 'North American Plate', w: 'North American Plate' } },
  { name: 'Delmarva Peninsula', lng: -75.0, lat: 38.3, km: 380, view: 135, title: 'Delmarva Peninsula', theme: 'sandstone', labels: { s: 'North American Plate', e: 'Continental Rise' } },
  { name: 'Columbia River Gorge, Oregon', lng: -121.85, lat: 45.66, km: 50, view: 200, title: 'Columbia River Gorge', theme: 'basalt', labels: { s: 'Columbia River Basalt Group' } },
  { name: 'Rocky Mountain NP (Continental Divide), Colorado', lng: -105.75, lat: 40.3, km: 50, view: 200, title: 'The Continental Divide', theme: 'basalt', labels: { s: 'Front Range' } },
  { name: 'Grampian Mountains, Scotland', lng: -4.1, lat: 56.85, km: 90, view: 200, title: 'The Grampian Mountains', theme: 'basalt', labels: { s: 'Caledonian Orogeny' } },
  { name: 'Crater Lake, Oregon', lng: -122.11, lat: 42.94, km: 16, view: 200, title: 'Crater Lake', synth: 450, theme: 'basalt', labels: { s: 'Mount Mazama' } },
  { name: 'Grand Canyon, Arizona', lng: -112.08, lat: 36.17, km: 30, view: 200, title: 'The Grand Canyon', theme: 'clay', labels: { s: 'Colorado Plateau' } },
  { name: 'Hawaiʻi (Big Island)', lng: -155.5, lat: 19.6, km: 210, view: 200, title: 'Hawaii', theme: 'basalt', labels: { s: 'Pacific Plate' } },
];

const state = (window.__diorama = {
  sel: null,
  raw: null,
  water: null,
  built: null,
  labels: null,
  pinsBuilt: null,
  compass: null,
  layers: [],
  raised: null,
  surfaceBase: null,
  labelOverrides: new Map(),
  labelLock: null,
  pins: [],
  pinImage: null,
  osm: null,
  pending: {},
  rockCache: {},
  caustic: makeCausticTexture(),
  shadow: makeShadowTexture(),
  locator: null,
  customDem: null,
  framed: false,
});

// ======================= Map / selection =======================

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const map = (window.__map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    sources: {
      img: { type: 'raster', tiles: [`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`], tileSize: 256, maxzoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' },
      ref: { type: 'raster', tiles: [`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`], tileSize: 256, maxzoom: 19 },
    },
    layers: [
      { id: 'img', type: 'raster', source: 'img' },
      { id: 'ref', type: 'raster', source: 'ref', paint: { 'raster-opacity': 0.85 } },
    ],
  },
  center: [-84.72, 45.84],
  zoom: 7.5,
  attributionControl: { compact: true },
}));
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

const selGeoJSON = (b) => {
  const pts = b ? [...b.corners, b.corners[0]].map(({ x, y }) => {
    const p = worldToLngLat(x, y);
    return [p.lng, p.lat];
  }) : [];
  return { type: 'FeatureCollection', features: b ? [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [pts] } }] : [] };
};
const pinsGeoJSON = () => ({
  type: 'FeatureCollection',
  features: state.pins.map((p) => ({ type: 'Feature', properties: { name: p.name, color: p.color || $('pinColor').value }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } })),
});

map.on('load', () => {
  map.addSource('sel', { type: 'geojson', data: selGeoJSON(state.sel) });
  map.addLayer({ id: 'sel-fill', type: 'fill', source: 'sel', paint: { 'fill-color': '#ffffff', 'fill-opacity': 0.12 } });
  map.addLayer({ id: 'sel-line', type: 'line', source: 'sel', paint: { 'line-color': '#ffffff', 'line-width': 2 } });
  map.addSource('overlays', { type: 'geojson', data: layersGeoJSON(state.layers) });
  map.addLayer({ id: 'ov-fill', type: 'fill', source: 'overlays', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'fill'] } });
  map.addLayer({ id: 'ov-line', type: 'line', source: 'overlays', filter: ['!=', ['geometry-type'], 'Point'], paint: { 'line-color': ['get', 'color'], 'line-width': 2.5 } });
  map.addLayer({ id: 'ov-pt', type: 'circle', source: 'overlays', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-color': ['get', 'color'], 'circle-radius': 4 } });
  map.addSource('sketch', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'sketch-line', type: 'line', source: 'sketch', paint: { 'line-color': '#ffffff', 'line-width': 2, 'line-dasharray': [2, 1] } });
  map.addLayer({ id: 'sketch-pt', type: 'circle', source: 'sketch', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-color': '#ffffff', 'circle-radius': 4, 'circle-stroke-color': '#000', 'circle-stroke-width': 1 } });
  map.addSource('pins', { type: 'geojson', data: pinsGeoJSON() });
  map.addLayer({
    id: 'pins',
    type: 'circle',
    source: 'pins',
    paint: { 'circle-radius': 5, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 },
  });
});

// Block shape.
const shapeAspect = () => ({ square: 1, wide: 16 / 9, tall: 9 / 16 })[$('shape').value] ?? 1;

const toDeg = (r) => Math.round((r * 180) / Math.PI);
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function setSelection(b, { resetPending = true } = {}) {
  state.sel = b;
  if (resetPending) state.pending = {};
  map.getSource('sel')?.setData(selGeoJSON(b));
  const c = worldToLngLat(b.cx, b.cy);
  const { w, h } = bboxSizeMeters(b);
  const dims = Math.abs(w - h) < 1 ? `${(w / 1000).toFixed(1)} km square` : `${(w / 1000).toFixed(1)} × ${(h / 1000).toFixed(1)} km`;
  const turned = toDeg(b.angle) ? ` · rotated ${toDeg(b.angle)}°` : '';
  $('selInfo').textContent = `${dims}${turned} · centre ${c.lat.toFixed(3)}, ${c.lng.toFixed(3)}`;
  $('selAngle').value = toDeg(b.angle);
  syncLabels();
  $('btnBuild').disabled = false;
  if (state.raw && state.raw.bbox !== b) status('Area changed — press Build diorama to update.');
}

$('shape').onchange = () => {
  const b = state.sel;
  if (!b) return;
  const a = shapeAspect();
  const side = Math.sqrt(b.w * b.h);
  setSelection(b.with({ w: side * Math.sqrt(a), h: side / Math.sqrt(a) }), { resetPending: false });
};

let drawMode = false;
let drawStart = null;
function endDraw() {
  drawMode = false;
  drawStart = null;
  map.dragPan.enable();
  map.getCanvas().style.cursor = '';
  $('btnDraw').classList.remove('active');
}
$('btnDraw').onclick = () => {
  if (drawMode) return endDraw();
  showTab('map');
  setPinClick(false);
  drawMode = true;
  map.dragPan.disable();
  map.getCanvas().style.cursor = 'crosshair';
  $('btnDraw').classList.add('active');
};
map.on('mousedown', (e) => {
  if (!drawMode) return;
  drawStart = lngLatToWorld(e.lngLat.lng, e.lngLat.lat);
});
map.on('mousemove', (e) => {
  if (!drawStart) return;
  const p = lngLatToWorld(e.lngLat.lng, e.lngLat.lat);
  const dx = p.x - drawStart.x;
  const dy = p.y - drawStart.y;
  const a = shapeAspect();
  const sw = Math.max(Math.abs(dx), Math.abs(dy) * a);
  if (sw <= 0) return;
  const x1 = drawStart.x + Math.sign(dx || 1) * sw;
  const y1 = drawStart.y + Math.sign(dy || 1) * (sw / a);
  setSelection(rectAround((drawStart.x + x1) / 2, (drawStart.y + y1) / 2, Math.abs(x1 - drawStart.x), Math.abs(y1 - drawStart.y)));
});
window.addEventListener('mouseup', () => drawStart && endDraw());

// Move and rotate the selection.
const ROTATE_CURSOR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='26' height='26' viewBox='0 0 24 24' fill='none' stroke-linecap='round' stroke-linejoin='round'%3E%3Cg stroke='black' stroke-width='4'%3E%3Cpath d='M20 12a8 8 0 1 1-2.3-5.6'/%3E%3Cpath d='M20 4v4h-4'/%3E%3C/g%3E%3Cg stroke='white' stroke-width='2'%3E%3Cpath d='M20 12a8 8 0 1 1-2.3-5.6'/%3E%3Cpath d='M20 4v4h-4'/%3E%3C/g%3E%3C/svg%3E\") 13 13, crosshair";
let selHover = null;
let rotDrag = null;
let moveDrag = null;
const selScreen = () =>
  state.sel.corners.map(({ x, y }) => {
    const ll = worldToLngLat(x, y);
    return map.project([ll.lng, ll.lat]);
  });
function distToSeg(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
function selHitTest(pt) {
  const c = selScreen();
  for (let i = 0; i < 4; i++) {
    if (distToSeg(pt, c[i], c[(i + 1) % 4]) < 9) return 'rotate';
    if (Math.hypot(pt.x - c[i].x, pt.y - c[i].y) < 22) return 'rotate';
  }
  let inside = false;
  for (let i = 0, j = 3; i < 4; j = i++) {
    if (c[i].y > pt.y !== c[j].y > pt.y && pt.x < ((c[j].x - c[i].x) * (pt.y - c[i].y)) / (c[j].y - c[i].y) + c[i].x) inside = !inside;
  }
  return inside ? 'move' : null;
}
function setSelHover(mode) {
  if (mode === selHover) return;
  selHover = mode;
  map.getCanvas().style.cursor = mode === 'rotate' ? ROTATE_CURSOR : mode === 'move' ? 'move' : '';
  if (mode) map.dragPan.disable();
  else if (!drawMode) map.dragPan.enable();
}
map.on('mousemove', (e) => {
  if (rotDrag) {
    let a = rotDrag.a0 + Math.atan2(e.point.y - rotDrag.c.y, e.point.x - rotDrag.c.x) - rotDrag.p0;
    if (e.originalEvent.shiftKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
    setSelection(state.sel.with({ angle: wrapAngle(a) }), { resetPending: false });
    return;
  }
  if (moveDrag) {
    const p = lngLatToWorld(e.lngLat.lng, e.lngLat.lat);
    const hy = state.sel.y1 - state.sel.cy;
    const cy = Math.min(1 - hy, Math.max(hy, moveDrag.cy + p.y - moveDrag.p.y));
    setSelection(state.sel.with({ cx: moveDrag.cx + p.x - moveDrag.p.x, cy }), { resetPending: false });
    return;
  }
  if (drawMode || pinClick || sketch || !state.sel) return setSelHover(null);
  setSelHover(selHitTest(e.point));
});
map.on('mousedown', (e) => {
  if (!selHover || drawMode || !state.sel) return;
  if (selHover === 'move') {
    moveDrag = { p: lngLatToWorld(e.lngLat.lng, e.lngLat.lat), cx: state.sel.cx, cy: state.sel.cy };
  } else {
    const ll = worldToLngLat(state.sel.cx, state.sel.cy);
    const c = map.project([ll.lng, ll.lat]);
    rotDrag = { c, a0: state.sel.angle, p0: Math.atan2(e.point.y - c.y, e.point.x - c.x) };
  }
  e.preventDefault();
});
window.addEventListener('mouseup', () => {
  if (!rotDrag && !moveDrag) return;
  rotDrag = moveDrag = null;
  setSelHover(null);
});
map.on('mouseout', () => !rotDrag && !moveDrag && setSelHover(null));
$('selAngle').addEventListener('input', () => {
  if (!state.sel) return;
  setSelection(state.sel.with({ angle: wrapAngle((val('selAngle') * Math.PI) / 180) }), { resetPending: false });
});
$('btnRotReset').onclick = () => state.sel && setSelection(state.sel.with({ angle: 0 }), { resetPending: false });

$('btnFit').onclick = () => {
  const bounds = map.getBounds();
  const a = lngLatToWorld(bounds.getWest(), bounds.getNorth());
  const b = lngLatToWorld(bounds.getEast(), bounds.getSouth());
  const asp = shapeAspect();
  const w = Math.min(b.x - a.x, (b.y - a.y) * asp) * 0.7;
  setSelection(rectAround((a.x + b.x) / 2, (a.y + b.y) / 2, w, w / asp));
};

async function search() {
  const q = $('search').value.trim();
  if (!q) return;
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`);
    const [hit] = await res.json();
    if (!hit) return status(`No match for "${q}"`);
    const [s, n, w, e] = hit.boundingbox.map(Number);
    showTab('map');
    map.fitBounds([[w, s], [e, n]], { padding: 60, maxZoom: 12 });
  } catch (err) {
    status(`Search failed: ${err.message}`);
  }
}
$('btnSearch').onclick = search;
$('search').addEventListener('keydown', (e) => e.key === 'Enter' && search());

PRESETS.forEach((p, i) => $('preset').add(new Option(p.name, i)));
$('preset').onchange = () => {
  const p = PRESETS[$('preset').value];
  if (!p) return;
  const b = rectFromLngLat(p.lng, p.lat, p.km, shapeAspect());
  setSelection(b);
  state.pending = { synth: p.synth };
  $('title').value = p.title;
  $('theme').value = p.theme;
  $('view').value = p.view;
  for (const k of ['n', 'e', 's', 'w']) $(`label_${k}`).value = p.labels?.[k] || '';
  showTab('map');
  const nw = worldToLngLat(b.x0, b.y0);
  const se = worldToLngLat(b.x1, b.y1);
  map.fitBounds([[nw.lng, se.lat], [se.lng, nw.lat]], { padding: 80, duration: 1200 });
};

// ======================= 3D stage =======================

const stage = $('stage');
const glCanvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = (window.__camera = new THREE.PerspectiveCamera(26, 16 / 9, 1, 5000));
const controls = (window.__controls = new OrbitControls(camera, glCanvas));
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 60;
controls.maxDistance = 900;
const sky = new THREE.HemisphereLight(0xffffff, 0x3a3530, 1.1);
scene.add(sky);
const sun = new THREE.DirectionalLight(0xfff6ea, 2.4);
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.camera.left = sun.shadow.camera.bottom = -90;
sun.shadow.camera.right = sun.shadow.camera.top = 90;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 900;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);

// Block rotation.
const blockAngle = () => state.raw?.bbox.angle || 0;

// View azimuth.
function lookAzimuth() {
  const v = new THREE.Vector3().subVectors(controls.target, camera.position);
  return ((Math.atan2(v.x, -v.z) * 180) / Math.PI + (blockAngle() * 180) / Math.PI + 720) % 360;
}

function setView() {
  const bearing = (+$('view').value * Math.PI) / 180 - blockAngle();
  const tilt = (+$('tilt').value * Math.PI) / 180;
  const height = state.built ? state.built.topY - state.built.baseY : 10;
  const r = 215 + height * 1.6;
  const cy = state.built ? (state.built.baseY + state.built.topY) * 0.5 : 0;
  controls.target.set(0, cy, 0);
  camera.position.set(Math.sin(bearing) * Math.cos(tilt) * r, cy + Math.sin(tilt) * r, -Math.cos(bearing) * Math.cos(tilt) * r);
  controls.update();
}
$('view').onchange = () => {
  setView();
  rebuildCompass();
  rebuildLabels();
};
$('tilt').oninput = setView;

// Stage layout.
const overlayCanvas = $('overlay');
const locatorCanvas = $('locator');
function layoutStage() {
  const host = $('stageWrap').hidden ? $('viewport') : $('stageWrap');
  const aw = host.clientWidth;
  const ah = host.clientHeight;
  let w = aw;
  let h = (aw * 9) / 16;
  if (h > ah) {
    h = ah;
    w = (ah * 16) / 9;
  }
  stage.style.width = `${w}px`;
  stage.style.height = `${h}px`;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  const dpr = Math.min(window.devicePixelRatio, 2);
  for (const c of [overlayCanvas, locatorCanvas]) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }
  drawOverlays(true);
}
new ResizeObserver(layoutStage).observe($('viewport'));

function credits() {
  const lines = [];
  const who = $('cartographer').value.trim();
  if (who) lines.push(`Cartography  |  ${who}`);
  lines.push('Elevation  |  AWS Terrain Tiles (Mapzen Terrarium: SRTM, GEBCO, ETOPO1 et al.)' + (state.customDem ? ` + ${state.customDem.name}` : ''));
  lines.push('Imagery  |  Esri World Imagery (Esri, Maxar, Earthstar Geographics)');
  if ($('wInland').checked && state.raw?.occ) lines.push('Surface water  |  EC JRC / Google Global Surface Water');
  if (state.labels?.count || boundaryLevels().length) lines.push('Labels & boundaries  |  © OpenStreetMap contributors, OpenFreeMap');
  return lines.join('\n');
}

// Locator.
const locatorSide = () => $('locatorSide').value;
// Credits corner.
const creditsCorner = () => {
  const v = $('creditsCorner').value;
  if (v !== 'auto') return v;
  return checked('showLocator') && locatorSide() === 'right' ? 'bl' : 'br';
};

// Full-side locator.
async function ensureSideLocator() {
  const b = state.raw?.bbox;
  if (!b) return;
  const key = `${b.cx},${b.cy},${b.w},${b.h},${b.angle}`;
  if (state.side?.key === key) return;
  const sl = (state.side = { key, data: null });
  try {
    const span = Math.max(b.w, b.h);
    const rs = Math.min(1, span * 7);
    const region = squareAround(b.cx, Math.min(1 - rs / 2, Math.max(rs / 2, b.cy)), rs);
    const [im, dm, wm] = await Promise.all([
      fetchMosaic(SOURCES.imagery, region, pickZoom(region, 1600, 12, 150)),
      fetchMosaic(SOURCES.dem, region, pickZoom(region, 700, 10, 64)),
      fetchMosaic(SOURCES.water, region, pickZoom(region, 1000, 11, 100)).catch(() => null),
    ]);
    const out = document.createElement('canvas');
    out.width = im.canvas.width;
    out.height = im.canvas.height;
    const ctx = out.getContext('2d');
    ctx.drawImage(im.canvas, 0, 0);
    const cut = (grid, isWater) => {
      const m = document.createElement('canvas');
      m.width = grid.w;
      m.height = grid.h;
      const mc = m.getContext('2d');
      const id = mc.createImageData(grid.w, grid.h);
      for (let i = 0; i < grid.data.length; i++) if (isWater(grid.data[i])) id.data[i * 4 + 3] = 255;
      mc.putImageData(id, 0, 0);
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(m, 0, 0, out.width, out.height);
      ctx.restore();
    };
    cut(DEM.decodeTerrarium(dm.canvas), (e) => e <= 0);
    if (wm) cut(DEM.decodeOccurrence(wm.canvas), (o) => o >= 50);
    if (state.side !== sl) return;
    sl.data = prepareSideLocator(out, region, b);
    drawOverlays(true);
  } catch (err) {
    console.warn('Side locator failed', err);
  }
}
let worldImage = null;
function ensureGlobe() {
  const b = state.raw?.bbox;
  if (!b || $('locatorStyle').value !== 'globe') return;
  const key = `${b.cx},${b.cy},${b.w},${b.h},${b.angle}`;
  if (state.globe?.key === key) return;
  state.globe = { key, data: null };
  worldImage ??= fetchMosaic(SOURCES.imagery, { x0: 0, y0: 0, x1: 1, y1: 1 }, 3).then((m) => m.canvas);
  const g = state.globe;
  worldImage.then((img) => {
    const c = worldToLngLat(b.cx, b.cy);
    g.data = prepareGlobe(img, c.lng, c.lat);
    g.corners = b.corners.map(({ x, y }) => {
      const p = worldToLngLat(x, y);
      return [p.lng, p.lat];
    });
    drawOverlays(true);
  });
}
function drawLocatorAny(ctx, W, H, az) {
  if (!checked('showLocator')) return;
  const style = $('locatorStyle').value;
  if (style === 'globe') {
    ensureGlobe();
    if (state.globe?.data) drawGlobe(ctx, W, H, state.globe.data, state.globe.corners, az, checked('showArrow'), locatorSide());
  } else if (style === 'side') {
    ensureSideLocator();
    if (state.side?.data) drawSideLocator(ctx, W, H, state.side.data, az, checked('showArrow'), locatorSide());
  } else drawLocator(ctx, W, H, state.locator, az, checked('showArrow'), locatorSide());
}

const descriptor = () => ({ text: $('descText').value, position: $('descPos').value, opacity: val('descOpacity'), size: val('descSize') });

let lastView = '';
function drawOverlays(force = false) {
  const az = lookAzimuth();
  const view = [camera.position.x, camera.position.y, camera.position.z, controls.target.x, controls.target.y, controls.target.z].map((v) => v.toFixed(1)).join();
  if (!force && view === lastView) return;
  lastView = view;
  const lc = locatorCanvas.getContext('2d');
  lc.clearRect(0, 0, locatorCanvas.width, locatorCanvas.height);
  if (state.built) {
    drawDescriptor(lc, locatorCanvas.width, locatorCanvas.height, descriptor());
    drawLocatorAny(lc, locatorCanvas.width, locatorCanvas.height, az);
    if ($('titlePos').value === 'bottom') drawTitle(lc, locatorCanvas.width, locatorCanvas.height, $('title').value, '', 'bottom', creditsCorner());
  }
  const oc = overlayCanvas.getContext('2d');
  oc.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  if (state.built) {
    const frontTitle = $('titlePos').value === 'bottom' ? '' : $('title').value;
    const anchor = drawTitle(oc, overlayCanvas.width, overlayCanvas.height, frontTitle, credits(), $('titlePos').value, creditsCorner());
    drawScaleBar(oc, overlayCanvas.width, overlayCanvas.height, pxPerMeterAtCentre(overlayCanvas.width, overlayCanvas.height), $('scaleUnits').value, anchor);
  }
}
for (const id of ['title', 'cartographer', 'titlePos', 'descText', 'descPos', 'descOpacity', 'descSize', 'showLocator', 'showArrow', 'scaleUnits', 'locatorStyle', 'locatorSide', 'creditsCorner']) {
  $(id).addEventListener('input', () => {
    syncLabels();
    drawOverlays(true);
  });
}
document.fonts?.ready.then(() => {
  drawOverlays(true);
  rebuildLabels();
});

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  const shift = $('showLocator').checked && $('locatorStyle').value === 'side' ? ($('locatorSide').value === 'right' ? 3.4 : -3.4) : 0;
  if (camera.filmOffset !== shift) {
    camera.filmOffset = shift;
    camera.updateProjectionMatrix();
  }
  state.pinsBuilt?.face(Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z));
  if ($('lightMode').value === 'fixed') {
    const az = (+$('lightAz').value * Math.PI) / 180 - (state.raw?.bbox.angle || 0);
    const alt = (+$('lightAlt').value * Math.PI) / 180;
    sun.position.set(Math.sin(az) * Math.cos(alt) * 320, Math.sin(alt) * 320, -Math.cos(az) * Math.cos(alt) * 320);
  } else {
    const az = Math.atan2(camera.position.x - controls.target.x, -(camera.position.z - controls.target.z)) - 0.9;
    sun.position.set(Math.sin(az) * 200, 260, -Math.cos(az) * 200);
  }
  sun.intensity = +$('lightPow').value;
  sky.intensity = +$('lightAmb').value;
  sun.castShadow = $('castShadows').checked;
  state.built?.waterSurface?.material.uniforms.uLightDir.value.copy(sun.position).normalize();
  state.labels?.update(camera);
  renderer.render(scene, camera);
  if (!$('stageWrap').hidden) drawOverlays();
}
animate();

// ======================= Build pipeline =======================

function status(msg, frac = null) {
  $('status').textContent = msg;
  const bar = $('progress');
  bar.hidden = frac === null;
  if (frac !== null) bar.value = frac;
}

const val = (id) => +$(id).value;
const checked = (id) => $(id).checked;

function readOptions() {
  return {
    meshN: val('meshRes') + 1,
    exaggeration: val('exag'),
    seaLevel: val('seaLevel'),
    ocean: checked('wOcean'),
    inland: checked('wInland'),
    occThreshold: val('wOcc'),
    detectFlat: checked('wFlat'),
    synth: val('synth'),
    baseDepth: val('baseDepth'),
    tint: val('tint'),
    waterOpacity: val('waterOpacity'),
    ripple: val('ripple'),
    hs: val('hs'),
    saturation: val('sat'),
    contrast: val('contrast'),
    smooth: val('smooth'),
    theme: $('theme').value,
    wallTint: checked('wallTintOn') ? $('wallTint').value : null,
    topo:
      $('renderStyle').value === 'topo'
        ? {
            layers: val('topoLayers'),
            smooth: val('topoSmooth'),
            color: $('topoColor').value,
            mono: $('topoMono').value,
            ramp: $('topoRamp').value,
            low: $('topoLow').value,
            high: $('topoHigh').value,
            water: $('topoWater').value,
            waterColor: $('topoWaterColor').value,
          }
        : null,
    labels: { n: $('label_n').value, e: $('label_e').value, s: $('label_s').value, w: $('label_w').value },
  };
}

function autoExaggeration(hi) {
  const { min, max } = DEM.stats(hi);
  const e = (0.08 * Math.sqrt(state.raw.size.w * state.raw.size.h)) / Math.max(1, max - min);
  return Math.max(1, Math.min(60, Math.round(e * 2) / 2));
}

function imageryLuminance(img, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < lum.length; i++) lum[i] = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255;
  return lum;
}

function waterModel(o, synth = o.synth) {
  const r = state.raw;
  return DEM.computeWater(r.hiRaw, {
    seaLevel: o.seaLevel,
    ocean: o.ocean,
    occurrence: o.inland && r.occ ? r.occ : null,
    occThreshold: o.occThreshold,
    detectFlat: o.detectFlat || (o.inland && !r.occ),
    lum: r.lum,
    synthDepth: synth,
  });
}

async function buildFromSelection() {
  const b = state.sel;
  if (!b) return status('Draw or pick an area first.');
  $('btnBuild').disabled = true;
  try {
    const t0 = performance.now();
    const meshRes = val('meshRes');
    const span = Math.max(b.w, b.h);
    const longPx = (z) => span * 256 * 2 ** z;
    const zd = pickZoom({ ...b, x1: b.x0 + span }, Math.max(meshRes * 1.5, 512), SOURCES.dem.maxZoom, 400);
    status(`Elevation tiles (zoom ${zd})…`, 0);
    const dm = await fetchMosaic(SOURCES.dem, b, zd, (d, n) => status(`Elevation tiles (zoom ${zd}) ${d}/${n}`, d / n));
    const hiLong = Math.round(Math.min(2048, Math.max(256, meshRes, Math.min(longPx(zd), 1024))));
    const wide = b.w >= b.h;
    const hiW = wide ? hiLong : Math.max(2, Math.round((hiLong * b.w) / b.h));
    const hiH = wide ? Math.max(2, Math.round((hiLong * b.h) / b.w)) : hiLong;
    const hi = DEM.resampleFrame(DEM.decodeTerrarium(dm.canvas), b, hiW, hiH);
    if ($('clean').checked) DEM.despike(hi, 40);
    if (state.customDem) {
      status('Merging custom DEM…');
      const n = await DEM.mergeGeoTiff(hi, b, state.customDem, { scale: val('cdScale'), offset: val('cdOffset') });
      $('cdInfo').textContent = `${state.customDem.name}: replaced ${((100 * n) / hi.data.length).toFixed(0)}% of cells`;
    }

    loadOsm(b);

    const zi = pickZoom({ ...b, x1: b.x0 + span }, val('imgRes'), SOURCES.imagery.maxZoom, 1200);
    const im = await fetchMosaic(SOURCES.imagery, b, zi, (d, n) => status(`Imagery tiles (zoom ${zi}) ${d}/${n}`, d / n));

    let occ = null;
    const zw = pickZoom({ ...b, x1: b.x0 + span }, hiLong, SOURCES.water.maxZoom, 400);
    try {
      const wm = await fetchMosaic(SOURCES.water, b, zw, (d, n) => status(`Surface water tiles (zoom ${zw}) ${d}/${n}`, d / n));
      occ = DEM.resampleFrame(DEM.decodeOccurrence(wm.canvas), b, hi.w, hi.h).data;
    } catch (err) {
      console.warn('Surface water unavailable', err);
    }

    const rs = Math.min(1, span * 9);
    const cx = b.cx;
    const cy = Math.min(1 - rs / 2, Math.max(rs / 2, b.cy));
    const region = squareAround(cx, cy, rs);
    const zl = pickZoom(region, 900, 13, 64);
    const lm = await fetchMosaic(SOURCES.imagery, region, zl, (d, n) => status(`Locator map ${d}/${n}`, d / n));
    state.locator = prepareLocator(lm, region, b);

    const imagery = b.angle ? canvasToFrame(im.canvas, b) : im.canvas;
    state.raw = { bbox: b, hiRaw: hi, imagery, lum: imageryLuminance(imagery, hi.w, hi.h), occ, size: bboxSizeMeters(b) };

    const probe = waterModel(readOptions(), 0);
    $('synth').value = state.pending.synth ?? (probe.flatFraction > 0.003 ? 40 : 0);
    $('exag').value = autoExaggeration(hi);
    syncLabels();

    state.framed = false;
    rebuild();
    showTab('3d');
    const failed = dm.failed + im.failed + lm.failed;
    status(`Built in ${((performance.now() - t0) / 1000).toFixed(1)} s · DEM z${zd}, imagery z${zi}${occ ? `, water z${zw}` : ''}${failed ? ` · ${failed} tiles failed` : ''}`);
  } catch (err) {
    console.error(err);
    status(`Build failed: ${err.message}`);
  } finally {
    $('btnBuild').disabled = false;
  }
}
$('btnBuild').onclick = buildFromSelection;

function rebuild() {
  const r = state.raw;
  if (!r) return;
  const o = readOptions();
  const water = waterModel(o);
  state.water = water;
  const bed = water.bed;
  const n = bed.w * bed.h;

  const mx = bed.w >= bed.h ? o.meshN : Math.max(2, Math.round((o.meshN - 1) * (bed.w - 1) / (bed.h - 1)) + 1);
  const my = bed.h > bed.w ? o.meshN : Math.max(2, Math.round((o.meshN - 1) * (bed.h - 1) / (bed.w - 1)) + 1);
  const mesh = DEM.resample(bed, mx, my);
  if (o.smooth) DEM.smooth(mesh, o.smooth);
  const surfFill = new Float32Array(n);
  for (let i = 0; i < n; i++) surfFill[i] = water.mask[i] ? water.surface[i] : bed.data[i];
  const meshSurf = DEM.resample({ w: bed.w, h: bed.h, data: surfFill }, mx, my);
  const meshMask = DEM.resample({ w: bed.w, h: bed.h, data: Float32Array.from(water.mask) }, mx, my);
  const maskHi = { w: bed.w, h: bed.h, data: water.mask.map((m) => m * 255) };

  let waterCells = 0;
  for (let i = 0; i < n; i++) waterCells += water.mask[i];
  $('waterInfo').textContent =
    `Water: ${((100 * waterCells) / n).toFixed(1)}% of block` +
    (o.inland ? (r.occ ? ' · lakes & rivers from surface-water map' : ' · surface-water map unavailable, using flat-water detection') : '');

  const hs = DEM.hillshade(bed, r.size.w / bed.w, Math.max(1, o.exaggeration * 0.5));
  const surface = makeSurface(r.imagery, bed, {
    mask: water.mask,
    depth: water.depth,
    depthRef: water.depthRef,
    tint: o.tint,
    hillshade: hs,
    hsStrength: o.hs,
    saturation: o.saturation,
    contrast: o.contrast,
    maxSize: Math.min(8192, renderer.capabilities.maxTextureSize),
  });
  const rockKey = o.wallTint ? `${o.theme}:${o.wallTint}` : o.theme;
  state.rockCache[rockKey] ??= makeRockTexture(o.wallTint ? tintedTheme(o.theme, o.wallTint) : o.theme);

  const built = buildDiorama(
    { grid: mesh, surf: meshSurf.data, mask: meshMask.data, maskHi, depthRef: water.depthRef, widthMeters: r.size.w, heightMeters: r.size.h },
    { exaggeration: o.exaggeration, baseDepth: o.baseDepth, waterOpacity: o.waterOpacity, ripple: o.ripple, wallTint: o.wallTint, labels: o.labels, topo: o.topo, shadows: checked('castShadows'), floorShadow: checked('floorShadow') },
    { surface: composeSurface(surface), rock: state.rockCache[rockKey], caustic: state.caustic, shadow: state.shadow },
  );
  if (state.built) {
    scene.remove(state.built.group);
    state.built.dispose();
  }
  state.built = built;
  scene.add(built.group);
  $('topoInterval').textContent = built.terrace ? `≈ ${fmtMeters(built.terrace.interval)} per layer` : '';
  if (!state.framed) {
    setView();
    state.framed = true;
  }
  for (const [name, fn] of [['Raised shapes', rebuildRaised], ['Compass', rebuildCompass], ['Labels', rebuildLabels], ['Pins', rebuildPins]]) {
    try {
      fn();
    } catch (err) {
      console.error(err);
      status(`${name} failed: ${err.message}`);
    }
  }
  drawOverlays(true);
  $('btnExport').disabled = false;
  $('btnExportTex').disabled = false;
}

let rebuildTimer = null;
const scheduleRebuild = () => {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(rebuild, 180);
};

function syncLabels() {
  document.querySelectorAll('input[type=range][id]').forEach((el) => {
    const out = document.querySelector(`output[for=${el.id}]`);
    if (out) out.textContent = el.value;
  });
}
$('wallTintOn').addEventListener('input', () => ($('wallTintRow').hidden = !checked('wallTintOn')));
const styleInputs = ['wallTintOn', 'wallTint', 'exag', 'seaLevel', 'wOcean', 'wInland', 'wOcc', 'wFlat', 'synth', 'baseDepth', 'tint', 'waterOpacity', 'ripple', 'hs', 'sat', 'contrast', 'smooth', 'theme', 'label_n', 'label_e', 'label_s', 'label_w'];
for (const id of styleInputs) {
  $(id).addEventListener('input', () => {
    syncLabels();
    scheduleRebuild();
  });
}
$('tilt').addEventListener('input', syncLabels);
$('meshRes').onchange = scheduleRebuild;
$('btnExagAuto').onclick = () => {
  if (!state.raw) return;
  $('exag').value = autoExaggeration(state.raw.hiRaw);
  syncLabels();
  scheduleRebuild();
};

Object.entries(WALL_THEMES).forEach(([k, t]) => $('theme').add(new Option(t.label, k)));

$('customDem').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) {
    state.customDem = null;
    $('cdInfo').textContent = '';
    return;
  }
  try {
    $('cdInfo').textContent = 'Reading…';
    state.customDem = await DEM.loadGeoTiff(file);
    const [a, b2, c, d] = state.customDem.bbox;
    $('cdInfo').textContent = `${file.name} · EPSG:${state.customDem.epsg} · ${state.customDem.width}×${state.customDem.height} · [${[a, b2, c, d].map((v) => v.toFixed(2)).join(', ')}]. Rebuild to apply.`;
  } catch (err) {
    state.customDem = null;
    $('cdInfo').textContent = err.message;
  }
};
$('cdClear').onclick = () => {
  state.customDem = null;
  $('customDem').value = '';
  $('cdInfo').textContent = '';
};

// ======================= Labels & boundaries =======================

const boundaryLevels = () => [['bndCountry', 2], ['bndState', 4], ['bndCounty', 6]].filter(([id]) => checked(id)).map(([, l]) => l);

function boundaryLines() {
  const o = state.osm;
  if (!o?.tiles || o.bbox !== state.raw?.bbox) return [];
  const levels = new Set(boundaryLevels());
  return o.tiles.boundaries.filter((l) => levels.has(l.level));
}

function osmInfo() {
  const o = state.osm;
  if (!o) return;
  const parts = [];
  if (!o.tiles && !o.features && !o.tilesError) parts.push('Loading labels…');
  else parts.push(`${state.labels?.count ?? 0} labels placed`);
  if (o.tilesError) parts.push(`vector tiles failed (${o.tilesError})`);
  if (o.osmState === 'loading') parts.push('adding OpenStreetMap detail…');
  else if (o.osmState === 'error') parts.push('OSM detail unavailable (server busy), basic labels shown');
  $('osmInfo').textContent = parts.join(' · ');
}

async function loadOsm(b) {
  const o = { bbox: b, tiles: null, features: null, geom: new Map(), osmState: 'loading' };
  state.osm = o;
  state.labelOverrides = new Map();
  state.labelLock = null;
  osmInfo();
  fetchTileData(b)
    .then((t) => {
      if (state.osm !== o) return;
      o.tiles = t;
      rebuildLabels();
      if (boundaryLevels().length) composeSurface();
    })
    .catch((err) => {
      o.tilesError = err.message;
      osmInfo();
    });
  try {
    o.features = await fetchFeatures(b);
    if (state.osm !== o) return;
    rebuildLabels();
    if (o.features.some((f) => f.bounds && f.cat !== 'water')) {
      try {
        o.adminSamples = await fetchAdminSamples(b);
        if (state.osm !== o) return;
        rebuildLabels();
      } catch (err) {
        console.warn('Admin containment lookup failed; using bounding boxes', err);
      }
    }
    o.geom = await fetchGeometry(b, geometryTargets(o.features));
    if (state.osm !== o) return;
    o.osmState = 'done';
    rebuildLabels();
  } catch (err) {
    if (state.osm === o) o.osmState = 'error';
    console.warn(err);
  }
  osmInfo();
}

for (const id of ['bndCountry', 'bndState', 'bndCounty']) $(id).addEventListener('change', () => composeSurface());

function rebuildLabels() {
  if (state.labels) {
    scene.remove(state.labels.group);
    state.labels.dispose();
    state.labels = null;
  }
  const o = state.osm;
  if (!state.built || !o || (!o.tiles && !o.features) || o.bbox !== state.raw?.bbox) return osmInfo();
  const geom = new Map(o.tiles?.geom || []);
  for (const [k, v] of o.geom) geom.set(k, v);
  state.labels = buildLabels([...(o.tiles?.features || []), ...(o.features || [])], geom, state.built, {
    show: { admin: checked('lblAdmin'), county: checked('lblCounty'), city: checked('lblCity'), feature: checked('lblFeature'), water: checked('lblWater') },
    size: val('lblSize'),
    font: $('lblFont').value,
    orient: $('lblOrient').value,
    ink: labelInk(),
    adminSamples: o.adminSamples,
    overrides: state.labelOverrides,
    lock: state.labelLock,
    reserved: state.compass ? [state.compass.footprint] : [],
    camera,
  });
  scene.add(state.labels.group);
  renderLabelList();
  osmInfo();
  drawOverlays(true);
}

// ======================= Label panel & dragging =======================

const CAT_TITLES = { admin: 'States & countries', county: 'Counties', city: 'Cities & towns', feature: 'Geographic features', water: 'Bodies of water' };
const KIND_NAMES = { mountain_range: 'range', village: 'village', town: 'town', city: 'city' };

function setOverride(key, patch) {
  const o = { ...(state.labelOverrides.get(key) || {}), ...patch };
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  if (Object.keys(o).length) state.labelOverrides.set(key, o);
  else state.labelOverrides.delete(key);
}

function renderLabelList() {
  const list = $('lblList');
  const cat = state.labels?.catalog || [];
  const q = $('lblSearch').value.trim().toLowerCase();
  list.textContent = '';
  if (!cat.length) {
    list.innerHTML = '<p class="hint">Labels appear here once the diorama is built.</p>';
    return;
  }
  for (const c of Object.keys(CAT_TITLES)) {
    const items = cat.filter((i) => i.cat === c && (!q || i.name.toLowerCase().includes(q))).sort((a, b) => b.placed - a.placed || b.rank - a.rank);
    if (!items.length) continue;
    const h = document.createElement('h3');
    h.textContent = `${CAT_TITLES[c]} (${items.filter((i) => i.placed).length}/${items.length})`;
    list.append(h);
    for (const i of items.slice(0, 150)) {
      const row = document.createElement('label');
      row.className = `lbl-item ${i.mode === 'on' ? 'forced' : i.mode === 'off' ? 'off' : ''}`;
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = i.placed;
      cb.onchange = () => {
        if (!cb.checked) lockCurrentSelection();
        setOverride(i.key, { mode: cb.checked ? 'on' : 'off' });
        rebuildLabels();
      };
      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = i.name;
      nm.title = i.mode === 'on' ? 'Forced on' : i.mode === 'off' ? 'Hidden' : 'Automatic';
      const kind = document.createElement('small');
      kind.textContent = (KIND_NAMES[i.kind] || i.kind).replace('_', ' ');
      row.append(cb, nm, kind);
      if (i.moved) {
        const dot = document.createElement('span');
        dot.className = 'moved-dot';
        dot.textContent = '●';
        const back = document.createElement('button');
        back.textContent = '↺';
        back.title = 'Put back in its automatic position';
        back.onclick = (e) => {
          e.preventDefault();
          setOverride(i.key, { uv: undefined });
          rebuildLabels();
        };
        row.append(dot, back);
      }
      list.append(row);
    }
  }
}
// Label lock.
function lockCurrentSelection() {
  if (state.labelLock || !state.labels) return;
  const shown = { admin: checked('lblAdmin'), county: checked('lblCounty'), city: checked('lblCity'), feature: checked('lblFeature'), water: checked('lblWater') };
  const lock = new Map();
  for (const [cat, on] of Object.entries(shown)) if (on) lock.set(cat, new Set());
  for (const c of state.labels.catalog) if (c.placed && lock.has(c.cat)) lock.get(c.cat).add(c.key);
  state.labelLock = lock;
}

$('lblSearch').addEventListener('input', renderLabelList);
$('lblResetAll').onclick = () => {
  state.labelOverrides = new Map();
  state.labelLock = null;
  rebuildLabels();
};
$('lblResetPos').onclick = () => {
  for (const [k] of state.labelOverrides) setOverride(k, { uv: undefined });
  rebuildLabels();
};
const setLabelPanel = (open) => {
  $('lblPanel').hidden = !open;
  $('lblPanelToggle').hidden = open || $('stageWrap').hidden;
  $('stageWrap').style.right = open ? '306px' : '0';
  layoutStage();
};
$('lblPanelToggle').onclick = () => setLabelPanel(true);
$('lblPanelClose').onclick = () => setLabelPanel(false);

// Label dragging.
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let drag = null;
function pickLabel(ev) {
  if (!state.labels) return null;
  const r = glCanvas.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  for (const hit of raycaster.intersectObjects(state.labels.group.children, true)) {
    let o = hit.object;
    while (o && !o.userData?.label) o = o.parent;
    if (o) return o;
  }
  return null;
}
glCanvas.addEventListener(
  'pointerdown',
  (ev) => {
    if (ev.button !== 0) return;
    const obj = pickLabel(ev);
    if (!obj) return;
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -obj.position.y);
    const p = new THREE.Vector3();
    const grab = raycaster.ray.intersectPlane(plane, p) ? obj.position.clone().sub(p) : new THREE.Vector3();
    drag = { obj, plane, grab, lift: obj.position.y - state.built.topAt(...state.built.toUV(obj.position.x, obj.position.z)) };
    controls.enabled = false;
    glCanvas.setPointerCapture(ev.pointerId);
    glCanvas.style.cursor = 'grabbing';
    ev.stopImmediatePropagation();
    ev.preventDefault();
  },
  { capture: true },
);
let hoverPending = false;
glCanvas.addEventListener('pointermove', (ev) => {
  if (drag) {
    const r = glCanvas.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const p = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(drag.plane, p)) return;
    p.add(drag.grab);
    const b = state.built;
    p.x = Math.max(-b.width / 2, Math.min(b.width / 2, p.x));
    p.z = Math.max(-b.depth / 2, Math.min(b.depth / 2, p.z));
    drag.obj.position.set(p.x, b.topAt(...b.toUV(p.x, p.z)) + drag.lift, p.z);
    return;
  }
  if (hoverPending) return;
  hoverPending = true;
  requestAnimationFrame(() => {
    hoverPending = false;
    glCanvas.style.cursor = pickLabel(ev) ? 'grab' : '';
  });
});
glCanvas.addEventListener('pointerup', (ev) => {
  if (!drag) return;
  const { obj } = drag;
  drag = null;
  controls.enabled = true;
  glCanvas.releasePointerCapture(ev.pointerId);
  glCanvas.style.cursor = 'grab';
  setOverride(obj.userData.key, { uv: state.built.toUV(obj.position.x, obj.position.z) });
  const entry = state.labels?.catalog.find((c) => c.key === obj.userData.key);
  if (entry) entry.moved = true;
  renderLabelList();
});

// ======================= Shapes & lines =======================

// Surface composite.
function composeSurface(base) {
  if (base) state.surfaceBase = base;
  const b = state.surfaceBase;
  if (!b) return null;
  let c = state.surfaceCanvas;
  if (!c || c.width !== b.width || c.height !== b.height) {
    c = document.createElement('canvas');
    c.width = b.width;
    c.height = b.height;
    state.surfaceCanvas = c;
  }
  const ctx = c.getContext('2d');
  ctx.drawImage(b, 0, 0);
  drawBoundaries(ctx, c.width, c.height, boundaryLines());
  if (state.raw) drawDraped(ctx, c.width, c.height, projectLayers(state.layers, state.raw.bbox));
  if (!base && state.built) state.built.surfaceTexture.needsUpdate = true;
  return c;
}

function rebuildRaised() {
  if (state.raised) {
    scene.remove(state.raised.group);
    state.raised.dispose();
    state.raised = null;
  }
  if (!state.built || !state.layers.some((l) => l.visible && l.style.mode === 'raised')) return;
  state.raised = buildRaised(projectLayers(state.layers, state.raw.bbox), state.built);
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  state.raised.setResolution(size.x, size.y);
  scene.add(state.raised.group);
}

function refreshLayers() {
  map.getSource('overlays')?.setData(layersGeoJSON(state.layers));
  composeSurface();
  rebuildRaised();
  renderLayerList();
  drawOverlays(true);
}

function renderLayerList() {
  const list = $('ovList');
  list.textContent = '';
  for (const l of state.layers) {
    const card = document.createElement('div');
    card.className = 'ov-card';
    const hasPolys = l.data.polys.length > 0;
    card.innerHTML = `
      <div class="ov-head">
        <input type="checkbox" data-k="visible" ${l.visible ? 'checked' : ''} title="Show / hide">
        <span class="nm"></span><small>${l.data.count} feature${l.data.count === 1 ? '' : 's'}</small>
        <button class="mini" data-act="zoom" title="Show on the map">⌖</button>
        <button class="mini" data-act="remove" title="Remove layer">✕</button>
      </div>
      <div class="grid2">
        <label>Style <select data-k="mode"><option value="draped">Draped on terrain</option><option value="raised">Raised 3D line</option></select></label>
        <label>Colour <input type="color" data-k="color" value="${l.style.color}"></label>
        <label><span>Width <output>${l.style.width}</output></span><input type="range" data-k="width" min="1" max="14" step="0.5" value="${l.style.width}"></label>
        <label><span>Opacity <output>${l.style.opacity}</output></span><input type="range" data-k="opacity" min="0.1" max="1" step="0.05" value="${l.style.opacity}"></label>
        <label>Line <select data-k="dash"><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option></select></label>
        ${hasPolys ? `<label><span>Fill <output>${l.style.fill}</output></span><input type="range" data-k="fill" min="0" max="0.8" step="0.02" value="${l.style.fill}"></label>` : '<span></span>'}
      </div>
      <label class="check"><input type="checkbox" data-k="glow" ${l.style.glow ? 'checked' : ''}> Glow</label>`;
    card.querySelector('.nm').textContent = l.name;
    card.querySelector('.nm').title = l.name;
    card.querySelector('[data-k=mode]').value = l.style.mode;
    card.querySelector('[data-k=dash]').value = l.style.dash;
    let timer = null;
    card.querySelectorAll('[data-k]').forEach((el) => {
      el.addEventListener('input', () => {
        const k = el.dataset.k;
        const v = el.type === 'checkbox' ? el.checked : el.type === 'range' ? +el.value : el.value;
        if (k === 'visible') l.visible = v;
        else l.style[k] = v;
        const out = el.parentElement.querySelector('output');
        if (out) out.textContent = el.value;
        clearTimeout(timer);
        timer = setTimeout(() => {
          map.getSource('overlays')?.setData(layersGeoJSON(state.layers));
          composeSurface();
          rebuildRaised();
        }, 60);
      });
    });
    card.querySelector('[data-act=remove]').onclick = () => {
      state.layers = state.layers.filter((x) => x !== l);
      refreshLayers();
    };
    card.querySelector('[data-act=zoom]').onclick = () => {
      const all = [...l.data.lines.flat(), ...l.data.polys.flat(2), ...l.data.points];
      const lngs = all.map((c) => c[0]);
      const lats = all.map((c) => c[1]);
      showTab('map');
      map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 60, maxZoom: 13 });
    };
    list.append(card);
  }
}

$('ovFile').onchange = async (e) => {
  const files = [...e.target.files];
  if (!files.length) return;
  $('ovInfo').textContent = 'Reading…';
  try {
    const parsed = await parseFiles(files);
    const added = [];
    for (const { name, geojson } of parsed) {
      const layer = makeLayer(name, flatten(geojson));
      state.layers.push(layer);
      added.push(`${name} (${layer.data.count})`);
    }
    $('ovInfo').textContent = `Added ${added.join(', ')}.${state.raw ? '' : ' Build a diorama to see them in 3D.'}`;
  } catch (err) {
    console.error(err);
    $('ovInfo').textContent = `Could not read: ${err.message}`;
  }
  e.target.value = '';
  refreshLayers();
};

// Sketch tool.
let sketch = null;
const sketchGeoJSON = () => {
  if (!sketch) return { type: 'FeatureCollection', features: [] };
  const pts = sketch.hover ? [...sketch.pts, sketch.hover] : sketch.pts;
  const coords = sketch.kind === 'poly' && pts.length > 2 ? [...pts, pts[0]] : pts;
  return {
    type: 'FeatureCollection',
    features: [
      ...(coords.length > 1 ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: coords } }] : []),
      ...sketch.pts.map((c) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c } })),
    ],
  };
};
function startSketch(kind) {
  if (drawMode) endDraw();
  setPinClick(false);
  showTab('map');
  sketch = { kind, pts: [], hover: null };
  map.doubleClickZoom.disable();
  map.getCanvas().style.cursor = 'crosshair';
  $('btnDrawLine').classList.toggle('active', kind === 'line');
  $('btnDrawPoly').classList.toggle('active', kind === 'poly');
  $('ovInfo').textContent = 'Click to add points; double-click or Enter to finish, Esc to cancel.';
}
function finishSketch(save) {
  if (!sketch) return;
  const { kind, pts } = sketch;
  sketch = null;
  map.getSource('sketch')?.setData(sketchGeoJSON());
  map.getCanvas().style.cursor = '';
  setTimeout(() => map.doubleClickZoom.enable(), 0);
  $('btnDrawLine').classList.remove('active');
  $('btnDrawPoly').classList.remove('active');
  const ok = kind === 'line' ? pts.length >= 2 : pts.length >= 3;
  if (!save || !ok) {
    $('ovInfo').textContent = save ? 'Need at least 2 points for a line, 3 for a polygon.' : '';
    return;
  }
  const n = state.layers.filter((l) => l.drawn).length + 1;
  const data = kind === 'line' ? { lines: [pts], polys: [], points: [], count: 1 } : { lines: [], polys: [[[...pts, pts[0]]]], points: [], count: 1 };
  const layer = makeLayer(`Drawn ${kind === 'line' ? 'line' : 'polygon'} ${n}`, data);
  layer.drawn = true;
  state.layers.push(layer);
  $('ovInfo').textContent = `Added ${layer.name}.`;
  refreshLayers();
}
$('btnDrawLine').onclick = () => (sketch?.kind === 'line' ? finishSketch(true) : startSketch('line'));
$('btnDrawPoly').onclick = () => (sketch?.kind === 'poly' ? finishSketch(true) : startSketch('poly'));
map.on('click', (e) => {
  if (!sketch) return;
  const p = [e.lngLat.lng, e.lngLat.lat];
  const last = sketch.pts[sketch.pts.length - 1];
  if (!last || last[0] !== p[0] || last[1] !== p[1]) sketch.pts.push(p);
  map.getSource('sketch')?.setData(sketchGeoJSON());
});
map.on('dblclick', (e) => {
  if (!sketch) return;
  e.preventDefault();
  finishSketch(true);
});
map.on('mousemove', (e) => {
  if (!sketch || !sketch.pts.length) return;
  sketch.hover = [e.lngLat.lng, e.lngLat.lat];
  map.getSource('sketch')?.setData(sketchGeoJSON());
});
window.addEventListener('keydown', (e) => {
  if (!sketch) return;
  if (e.key === 'Enter') finishSketch(true);
  if (e.key === 'Escape') finishSketch(false);
});

// ======================= Render style, light & theme =======================

const fmtMeters = (m) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m >= 10 ? Math.round(m) : m.toFixed(1)} m`);

// Label ink.
function labelInk() {
  const v = $('labelInk').value;
  if (v !== 'auto') return v;
  if ($('renderStyle').value !== 'topo' || $('topoColor').value !== 'mono') return 'light';
  const c = new THREE.Color($('topoMono').value);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b > 0.55 ? 'dark' : 'light';
}

function syncLookControls() {
  const topo = $('renderStyle').value === 'topo';
  $('topoControls').hidden = !topo;
  const mode = $('topoColor').value;
  $('topoMonoRow').hidden = mode !== 'mono';
  $('topoRampRow').hidden = mode !== 'multi';
  $('topoCustomRow').hidden = $('topoRamp').value !== 'custom';
  $('lightFixed').hidden = $('lightMode').value !== 'fixed';
  const light = $('bgTheme').value === 'light';
  setOverlayTheme(light ? 'light' : 'dark');
  $('stage').classList.toggle('light', light);
}
for (const id of ['renderStyle', 'topoLayers', 'topoSmooth', 'topoColor', 'topoMono', 'topoRamp', 'topoLow', 'topoHigh', 'topoWater', 'topoWaterColor', 'castShadows', 'floorShadow']) {
  $(id).addEventListener('input', () => {
    syncLookControls();
    syncLabels();
    scheduleRebuild();
  });
}
for (const id of ['lightMode', 'lightAz', 'lightAlt', 'lightPow', 'lightAmb']) {
  $(id).addEventListener('input', () => {
    syncLookControls();
    syncLabels();
  });
}
for (const id of ['bgTheme', 'labelInk']) {
  $(id).addEventListener('input', () => {
    syncLookControls();
    rebuildLabels();
    drawOverlays(true);
  });
}
syncLookControls();

// ======================= Compass =======================

function rebuildCompass() {
  if (state.compass) {
    scene.remove(state.compass.group);
    state.compass.dispose();
    state.compass = null;
  }
  if (!state.built || !checked('compassOn')) return;
  state.compass = buildCompass(state.built, camera, {
    color: $('compassColor').value,
    size: val('compassSize'),
    opacity: val('compassOpacity'),
    position: $('compassPos').value,
    north: blockAngle(),
  });
  scene.add(state.compass.group);
}
for (const id of ['compassOn', 'compassPos', 'compassColor', 'compassSize', 'compassOpacity']) {
  $(id).addEventListener('input', () => {
    syncLabels();
    rebuildCompass();
    rebuildLabels();
  });
}

// ======================= Scale bar =======================

// Scale at the block centre.
function pxPerMeterAtCentre(W, H) {
  const b = state.built;
  if (!b) return 0;
  camera.updateMatrixWorld();
  const c = new THREE.Vector3(0, b.topAt(0.5, 0.5), 0);
  const r = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(10);
  const p0 = c.clone().project(camera);
  const p1 = c.clone().add(r).project(camera);
  const px = Math.hypot(((p1.x - p0.x) * W) / 2, ((p1.y - p0.y) * H) / 2);
  return px / 10 / b.metersPerUnit;
}

let labelTimer = null;
for (const id of ['lblAdmin', 'lblCounty', 'lblCity', 'lblFeature', 'lblWater', 'lblFont', 'lblSize', 'lblOrient']) {
  $(id).addEventListener('input', () => {
    syncLabels();
    clearTimeout(labelTimer);
    labelTimer = setTimeout(rebuildLabels, 120);
  });
}

// ======================= Pins =======================

Object.entries(PIN_STYLES).forEach(([k, label]) => $('pinStyle').add(new Option(label, k)));

function applyPins() {
  const { pins, errors, truncated } = parsePins($('pinText').value);
  state.pins = pins;
  map.getSource('pins')?.setData(pinsGeoJSON());
  rebuildPins();
  const msg = [];
  msg.push(`${pins.length} location${pins.length === 1 ? '' : 's'}`);
  if (state.pinsBuilt) msg.push(`${state.pinsBuilt.shown} on the block${state.pinsBuilt.outside ? `, ${state.pinsBuilt.outside} outside it` : ''}`);
  if (truncated) msg.push(`${truncated} over the ${MAX_PINS} limit ignored`);
  if (state.pinsBuilt?.labelsCapped) msg.push(`names shown for the first ${MAX_PIN_LABELS}`);
  if (errors.length) msg.push(`${errors.length} row${errors.length === 1 ? '' : 's'} skipped (${errors.slice(0, 2).join('; ')}${errors.length > 2 ? '…' : ''})`);
  $('pinInfo').textContent = msg.join(' · ');
}

function rebuildPins() {
  if (state.pinsBuilt) {
    scene.remove(state.pinsBuilt.group);
    state.pinsBuilt.dispose();
    state.pinsBuilt = null;
  }
  $('pinImageRow').hidden = !($('pinStyle').value === 'image' || state.pins.some((p) => p.style === 'image'));
  if (!state.built || !state.pins.length) return;
  try {
    state.pinsBuilt = buildPins(state.pins, state.raw.bbox, state.built, {
      style: $('pinStyle').value,
      color: $('pinColor').value,
      size: val('pinSize'),
      labels: checked('pinLabels'),
      image: state.pinImage ? { img: state.pinImage, colours: $('pinImageColours').value, depth: val('pinImageDepth'), stem: checked('pinImageStem') } : null,
    });
  } catch (err) {
    console.warn('Pins failed', err);
    $('pinImageInfo').textContent = `Couldn't build the image heads: ${err.message}`;
    return;
  }
  scene.add(state.pinsBuilt.group);
}

let pinTimer = null;
$('pinText').addEventListener('input', () => {
  clearTimeout(pinTimer);
  pinTimer = setTimeout(applyPins, 300);
});
for (const id of ['pinStyle', 'pinColor', 'pinSize', 'pinLabels', 'pinImageColours', 'pinImageDepth', 'pinImageStem']) {
  $(id).addEventListener('input', () => {
    syncLabels();
    map.getSource('pins')?.setData(pinsGeoJSON());
    clearTimeout(pinTimer);
    pinTimer = setTimeout(applyPins, 120);
  });
}
$('pinFile').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  $('pinText').value = await file.text();
  applyPins();
};
$('pinImage').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const img = await loadPinImage(file);
    state.pinImage?.texture.dispose();
    state.pinImage = img;
    $('pinImageInfo').textContent = `${file.name} · ${img.src.width}×${img.src.height}px`;
    if ($('pinStyle').value !== 'image' && !state.pins.some((p) => p.style === 'image')) {
      $('pinStyle').value = 'image';
      $('pinStyle').dispatchEvent(new Event('change'));
    }
    applyPins();
  } catch (err) {
    $('pinImageInfo').textContent = `Couldn't use that image: ${err.message}`;
  }
};
$('btnPinClear').onclick = () => {
  $('pinText').value = '';
  $('pinFile').value = '';
  applyPins();
};

let pinClick = false;
function setPinClick(on) {
  pinClick = on;
  $('btnPinClick').classList.toggle('active', on);
  map.getCanvas().style.cursor = on ? 'crosshair' : '';
}
$('btnPinClick').onclick = () => {
  if (drawMode) endDraw();
  setPinClick(!pinClick);
  if (pinClick) showTab('map');
};
map.on('click', (e) => {
  if (!pinClick) return;
  const t = $('pinText');
  const lines = t.value.trim() ? t.value.trim().split(/\r?\n/) : [];
  if (!lines.length) lines.push('name,lat,lon');
  lines.push(`Pin ${lines.length},${e.lngLat.lat.toFixed(5)},${e.lngLat.lng.toFixed(5)}`);
  t.value = lines.join('\n');
  applyPins();
});

// ======================= Export =======================

function download(canvas, name) {
  canvas.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, 'image/png');
}
const slug = () => ($('title').value || 'diorama').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

$('btnExport').onclick = async () => {
  const [W, H] = $('exportSize').value.split('x').map(Number);
  status(`Rendering ${W}×${H}…`);
  await new Promise((r) => setTimeout(r, 30));
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const ctx = out.getContext('2d');
  drawBackground(ctx, W, H);
  drawDescriptor(ctx, W, H, descriptor());
  drawLocatorAny(ctx, W, H, lookAzimuth());
  if ($('titlePos').value === 'bottom') drawTitle(ctx, W, H, $('title').value, '', 'bottom', creditsCorner());

  const prevSize = renderer.getSize(new THREE.Vector2());
  const prevRatio = renderer.getPixelRatio();
  const prevAspect = camera.aspect;
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  state.raised?.setResolution(W, H);
  renderer.render(scene, camera);
  ctx.drawImage(glCanvas, 0, 0);
  const pxPerMeter = pxPerMeterAtCentre(W, H);
  renderer.setPixelRatio(prevRatio);
  renderer.setSize(prevSize.x, prevSize.y, false);
  state.raised?.setResolution(prevSize.x * prevRatio, prevSize.y * prevRatio);
  camera.aspect = prevAspect;
  camera.updateProjectionMatrix();

  const anchor = drawTitle(ctx, W, H, $('titlePos').value === 'bottom' ? '' : $('title').value, credits(), $('titlePos').value, creditsCorner());
  drawScaleBar(ctx, W, H, pxPerMeter, $('scaleUnits').value, anchor);
  download(out, `${slug()}-${W}x${H}.png`);
  status(`Exported ${W}×${H} PNG.`);
};

$('btnExportTex').onclick = () => state.surfaceCanvas && download(state.surfaceCanvas, `${slug()}-surface.png`);

// ======================= Tabs =======================

function showTab(which) {
  $('map').hidden = which !== 'map';
  $('stageWrap').hidden = which !== '3d';
  $('tabMap').classList.toggle('active', which === 'map');
  $('tab3d').classList.toggle('active', which === '3d');
  $('lblPanelToggle').hidden = which !== '3d' || !$('lblPanel').hidden;
  if (which === 'map') {
    $('lblPanel').hidden = true;
    $('stageWrap').style.right = '0';
  }
  if (which === 'map') map.resize();
  else layoutStage();
}
$('tabMap').onclick = () => showTab('map');
$('tab3d').onclick = () => showTab('3d');

syncLabels();
status('Ready — choose a place to begin.');
