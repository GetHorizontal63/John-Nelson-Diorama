// User shapes and lines.
import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';

const lib = {};
const load = async (key, url) => (lib[key] ??= await import(url));
const SHP = 'https://cdn.jsdelivr.net/npm/shpjs@6.1.0/+esm';
const TOGEOJSON = 'https://cdn.jsdelivr.net/npm/@tmcw/togeojson@5.8.1/+esm';
const FFLATE = 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/+esm';

export const DEFAULT_STYLE = { mode: 'draped', color: '#ff5a36', width: 3, opacity: 0.95, dash: 'solid', fill: 0.18, glow: true };
const PALETTE = ['#ff5a36', '#ffd23f', '#4fd3e0', '#b388ff', '#7cfc00', '#ff4fa3'];
let nextId = 1;

// ---------- parsing ----------

const ext = (f) => f.name.split('.').pop().toLowerCase();
const base = (f) => f.name.replace(/\.[^.]+$/, '').toLowerCase();

const parseXml = async (text, kind) => {
  const tg = await load('tg', TOGEOJSON);
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('the file is not valid XML');
  return tg[kind](doc);
};

// KMZ and zip archives.
async function parseArchive(f, buf) {
  const { unzipSync, strFromU8 } = await load('fflate', FFLATE);
  const files = unzipSync(new Uint8Array(buf), { filter: (e) => /\.(kml|geojson|json|gpx)$/i.test(e.name) && !e.name.startsWith('__MACOSX/') });
  const names = Object.keys(files).sort((a, b) => (/(^|\/)doc\.kml$/i.test(b) ? 1 : 0) - (/(^|\/)doc\.kml$/i.test(a) ? 1 : 0) || a.localeCompare(b));
  if (!names.length) throw new Error(`${f.name}: no KML, GeoJSON, GPX or shapefile inside`);
  const out = [];
  for (const n of names) {
    const text = strFromU8(files[n]);
    const e = n.split('.').pop().toLowerCase();
    const geojson = e === 'kml' || e === 'gpx' ? await parseXml(text, e) : JSON.parse(text);
    if (geojson.features?.length === 0) continue;
    const label = names.length === 1 ? f.name : `${f.name} · ${n.split('/').pop()}`;
    out.push({ name: label, geojson });
  }
  if (!out.length) throw new Error(`${f.name}: the KML inside has no placemarks to draw`);
  return out;
}

const hasShapefile = (buf) => {
  const bytes = new Uint8Array(buf);
  for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 65557; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 5 && bytes[i + 3] === 6) {
      const dv = new DataView(buf);
      let p = dv.getUint32(i + 16, true);
      const n = dv.getUint16(i + 10, true);
      for (let k = 0; k < n && p + 46 <= bytes.length; k++) {
        const len = dv.getUint16(p + 28, true);
        const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + len));
        if (/\.shp$/i.test(name)) return true;
        p += 46 + len + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
      }
      return false;
    }
  }
  return true;
};

// Parse uploaded files.
export async function parseFiles(files) {
  const out = [];
  const loose = new Map();
  for (const f of files) {
    const e = ext(f);
    if (['shp', 'dbf', 'prj', 'cpg'].includes(e)) {
      if (!loose.has(base(f))) loose.set(base(f), { name: f.name.replace(/\.[^.]+$/, '') });
      loose.get(base(f))[e] = f;
    } else if (e === 'kmz') {
      out.push(...(await parseArchive(f, await f.arrayBuffer())));
    } else if (e === 'zip') {
      const buf = await f.arrayBuffer();
      if (!hasShapefile(buf)) {
        out.push(...(await parseArchive(f, buf)));
        continue;
      }
      const shp = await load('shp', SHP);
      const res = await shp.parseZip(buf);
      for (const g of Array.isArray(res) ? res : [res]) out.push({ name: g.fileName || f.name, geojson: g });
    } else if (e === 'geojson' || e === 'json') {
      out.push({ name: f.name, geojson: JSON.parse(await f.text()) });
    } else if (e === 'kml' || e === 'gpx') {
      out.push({ name: f.name, geojson: await parseXml(await f.text(), e) });
    } else throw new Error(`Unsupported file type: ${f.name}`);
  }
  for (const set of loose.values()) {
    if (!set.shp) throw new Error(`${set.name}: the .shp file is missing (select .shp, .dbf and .prj together, or a .zip)`);
    const shp = await load('shp', SHP);
    const geoms = shp.parseShp(await set.shp.arrayBuffer(), set.prj ? await set.prj.text() : undefined);
    const dbf = set.dbf ? shp.parseDbf(await set.dbf.arrayBuffer(), set.cpg ? await set.cpg.text() : undefined) : undefined;
    out.push({ name: set.name, geojson: shp.combine([geoms, dbf]) });
  }
  return out;
}

// Flatten GeoJSON.
export function flatten(geojson) {
  const lines = [];
  const polys = [];
  const points = [];
  const visit = (g) => {
    if (!g) return;
    switch (g.type) {
      case 'FeatureCollection':
        g.features.forEach((f) => visit(f.geometry));
        break;
      case 'Feature':
        visit(g.geometry);
        break;
      case 'GeometryCollection':
        g.geometries.forEach(visit);
        break;
      case 'LineString':
        lines.push(g.coordinates);
        break;
      case 'MultiLineString':
        lines.push(...g.coordinates);
        break;
      case 'Polygon':
        polys.push(g.coordinates);
        break;
      case 'MultiPolygon':
        polys.push(...g.coordinates);
        break;
      case 'Point':
        points.push(g.coordinates);
        break;
      case 'MultiPoint':
        points.push(...g.coordinates);
        break;
    }
  };
  visit(geojson);
  const all = [...lines.flat(), ...polys.flat(2), ...points];
  if (!all.length) throw new Error('no geometry found');
  if (all.some(([x, y]) => Math.abs(x) > 180 || Math.abs(y) > 90)) {
    throw new Error('coordinates are not longitude/latitude; include the .prj file (or reproject to EPSG:4326)');
  }
  return { lines, polys, points, count: lines.length + polys.length + points.length };
}

export function makeLayer(name, data, style = {}) {
  const id = nextId++;
  return { id, name, data, visible: true, style: { ...DEFAULT_STYLE, color: PALETTE[(id - 1) % PALETTE.length], ...style } };
}

// ---------- projection & clipping to the block ----------

// Block coordinates.
const toUV = (b, [lng, lat]) => b.lngLatToUV(lng, lat);

// Liang-Barsky clip.
function clipSeg(a, b, m = 0) {
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  for (const [p, q] of [[-dx, a[0] + m], [dx, 1 + m - a[0]], [-dy, a[1] + m], [dy, 1 + m - a[1]]]) {
    if (p === 0) {
      if (q < 0) return null;
    } else {
      const r = q / p;
      if (p < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
      if (t0 > t1) return null;
    }
  }
  return [[a[0] + t0 * dx, a[1] + t0 * dy], [a[0] + t1 * dx, a[1] + t1 * dy]];
}

// Clip a polyline to the block.
function clipLine(pts, m = 0) {
  const pieces = [];
  let cur = [];
  for (let i = 1; i < pts.length; i++) {
    const s = clipSeg(pts[i - 1], pts[i], m);
    if (!s) {
      if (cur.length > 1) pieces.push(cur);
      cur = [];
      continue;
    }
    const last = cur[cur.length - 1];
    if (!last || Math.hypot(last[0] - s[0][0], last[1] - s[0][1]) > 1e-9) {
      if (cur.length > 1) pieces.push(cur);
      cur = [s[0]];
    }
    cur.push(s[1]);
  }
  if (cur.length > 1) pieces.push(cur);
  return pieces;
}

// Project layers to the block.
export function projectLayers(layers, b) {
  return layers
    .filter((l) => l.visible)
    .map((l) => ({
      style: l.style,
      lines: l.data.lines.flatMap((ln) => clipLine(ln.map((c) => toUV(b, c)))),
      rings: l.data.polys.map((poly) => poly.map((ring) => ring.map((c) => toUV(b, c)))),
      points: l.data.points.map((c) => toUV(b, c)).filter(([u, v]) => u >= 0 && u <= 1 && v >= 0 && v <= 1),
    }));
}

// ---------- draped (drawn into the terrain texture) ----------

const DASH = { solid: [], dashed: [6, 4], dotted: [0.5, 3] };

export function drawDraped(ctx, w, h, projected) {
  const k = Math.max(w, h) / 1600;
  for (const L of projected) {
    const st = L.style;
    if (st.mode !== 'draped' && !(L.rings.length && st.fill > 0)) continue;
    ctx.save();
    ctx.globalAlpha = st.opacity;
    ctx.lineJoin = 'round';
    ctx.lineCap = st.dash === 'dotted' ? 'round' : 'butt';
    if (L.rings.length && st.fill > 0) {
      const path = new Path2D();
      for (const poly of L.rings) for (const ring of poly) ring.forEach(([u, v], i) => (i ? path.lineTo(u * w, v * h) : path.moveTo(u * w, v * h)));
      ctx.globalAlpha = st.opacity * st.fill;
      ctx.fillStyle = st.color;
      ctx.fill(path, 'evenodd');
      ctx.globalAlpha = st.opacity;
    }
    if (st.mode === 'draped') {
      const path = new Path2D();
      for (const line of L.lines) line.forEach(([u, v], i) => (i ? path.lineTo(u * w, v * h) : path.moveTo(u * w, v * h)));
      for (const poly of L.rings) for (const ring of poly) ring.forEach(([u, v], i) => (i ? path.lineTo(u * w, v * h) : path.moveTo(u * w, v * h)));
      const lw = Math.max(1, st.width * k);
      if (st.glow) {
        ctx.save();
        ctx.strokeStyle = st.color;
        ctx.globalAlpha = st.opacity * 0.45;
        ctx.lineWidth = lw * 3;
        ctx.filter = `blur(${lw * 1.2}px)`;
        ctx.stroke(path);
        ctx.restore();
      }
      ctx.strokeStyle = st.color;
      ctx.lineWidth = lw;
      ctx.setLineDash(DASH[st.dash].map((d) => d * lw));
      ctx.stroke(path);
      ctx.setLineDash([]);
      ctx.fillStyle = st.color;
      for (const [u, v] of L.points) {
        ctx.beginPath();
        ctx.arc(u * w, v * h, lw * 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}

// ---------- raised (3D lines floating above the terrain) ----------

// Densify.
function densify(pts, step = 1 / 400) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let s = 1; s <= n; s++) out.push([a[0] + ((b[0] - a[0]) * s) / n, a[1] + ((b[1] - a[1]) * s) / n]);
  }
  return out;
}

// Raised 3D lines.
export function buildRaised(projected, built) {
  const group = new THREE.Group();
  const mats = [];
  const geos = [];
  const lineFor = (pts, st, widthK, opacity, order) => {
    const pos = [];
    const lift = 0.5 + st.width * 0.06;
    for (const [u, v] of densify(pts)) {
      const { x, z } = built.toLocal(u, v);
      pos.push(x, built.topAt(u, v) + lift, z);
    }
    const g = new LineGeometry();
    g.setPositions(pos);
    const m = new LineMaterial({
      color: new THREE.Color(st.color),
      linewidth: st.width * 0.12 * widthK,
      worldUnits: true,
      transparent: true,
      opacity,
      dashed: st.dash !== 'solid',
      dashSize: st.dash === 'dotted' ? st.width * 0.1 : st.width * 0.6,
      gapSize: st.width * 0.4,
      depthWrite: false,
    });
    const line = new Line2(g, m);
    line.computeLineDistances();
    line.renderOrder = order;
    geos.push(g);
    mats.push(m);
    group.add(line);
  };
  for (const L of projected) {
    if (L.style.mode !== 'raised') continue;
    const pieces = [...L.lines, ...L.rings.flatMap((poly) => poly.flatMap((ring) => clipLine(ring)))];
    for (const pts of pieces) {
      if (pts.length < 2) continue;
      if (L.style.glow) lineFor(pts, { ...L.style, dash: 'solid' }, 2.2, L.style.opacity * 0.22, 7);
      lineFor(pts, L.style, 1, L.style.opacity, 8);
    }
    if (L.points.length) {
      const g = new THREE.SphereGeometry(0.25 + L.style.width * 0.06, 16, 12);
      const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(L.style.color), transparent: true, opacity: L.style.opacity });
      geos.push(g);
      mats.push(m);
      for (const [u, v] of L.points.slice(0, 2000)) {
        const s = new THREE.Mesh(g, m);
        const { x, z } = built.toLocal(u, v);
        s.position.set(x, built.topAt(u, v) + 0.6 + L.style.width * 0.06, z);
        group.add(s);
      }
    }
  }
  return {
    group,
    setResolution(w, h) {
      for (const m of mats) m.resolution?.set(w, h);
    },
    dispose() {
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
    },
  };
}

// ---------- 2D map preview ----------

export function layersGeoJSON(layers) {
  const features = [];
  for (const l of layers) {
    if (!l.visible) continue;
    const props = { color: l.style.color, fill: l.style.fill };
    for (const c of l.data.lines) features.push({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: c } });
    for (const c of l.data.polys) features.push({ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: c } });
    for (const c of l.data.points) features.push({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: c } });
  }
  return { type: 'FeatureCollection', features };
}
