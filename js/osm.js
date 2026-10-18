// OpenStreetMap data via the Overpass API.

import { worldToLngLat, bboxSideMeters } from './geo.js';

// Overpass endpoints.
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const cache = new Map();

async function overpass(query) {
  if (cache.has(query)) return cache.get(query);
  let lastErr;
  for (const url of ENDPOINTS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: query }) });
        if (res.status === 429 || res.status === 504) {
          lastErr = new Error(`${res.status} server busy`);
          await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
          continue;
        }
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const json = await res.json();
        if (json.remark && /error|timed out|rate_limited/i.test(json.remark)) throw new Error(json.remark.replace(/^.*?(runtime error:?)/i, '').slice(0, 120));
        cache.set(query, json);
        return json;
      } catch (err) {
        lastErr = err;
        break;
      }
    }
  }
  throw new Error(`Overpass API unavailable (${lastErr?.message || 'network error'})`);
}

function bboxString(b) {
  const nw = worldToLngLat(b.x0, b.y0);
  const se = worldToLngLat(b.x1, b.y1);
  return `${se.lat.toFixed(6)},${nw.lng.toFixed(6)},${nw.lat.toFixed(6)},${se.lng.toFixed(6)}`;
}

// Block coordinates.
function toUV(b, lng, lat) {
  return b.lngLatToUV(lng, lat);
}

const IGNORED_WATER = new Set(['river', 'canal', 'stream', 'pond', 'basin', 'wastewater', 'moat', 'ditch', 'fishpond', 'reflecting_pool', 'stream_pool', 'lock']);

function classify(t, type) {
  if (t.boundary === 'administrative') {
    const kind = { 2: 'country', 4: 'state', 6: 'county' }[t.admin_level];
    return kind ? { cat: kind === 'county' ? 'county' : 'admin', kind } : null;
  }
  if (type === 'node' && ['city', 'town', 'village'].includes(t.place)) return { cat: 'city', kind: t.place };
  if (t.place === 'sea' || t.place === 'ocean') return { cat: 'water', kind: 'sea' };
  if (t.waterway === 'river') return { cat: 'water', kind: 'river' };
  if (t.natural === 'bay') return { cat: 'water', kind: 'bay' };
  if (t.natural === 'strait') return { cat: 'water', kind: 'strait' };
  if (t.natural === 'water') return IGNORED_WATER.has(t.water) ? null : { cat: 'water', kind: 'lake' };
  if (t.place === 'island') return { cat: 'feature', kind: 'island' };
  if (t.natural === 'peak' || t.natural === 'volcano') return { cat: 'feature', kind: 'peak' };
  if (['peninsula', 'cape', 'ridge', 'valley', 'mountain_range', 'glacier'].includes(t.natural)) return { cat: 'feature', kind: t.natural };
  return null;
}

// Named features.
export async function fetchFeatures(b) {
  const bb = bboxString(b);
  const km = bboxSideMeters(b) / 1000;
  const places = km < 60 ? 'city|town|village' : km < 250 ? 'city|town' : 'city';
  const s = b.x1 - b.x0;
  const wide = bboxString({ x0: b.x0 - 3 * s, y0: Math.max(0.001, b.y0 - 3 * s), x1: b.x1 + 3 * s, y1: Math.min(0.999, b.y1 + 3 * s) });
  const q = `[out:json][timeout:90];
(
  node["place"~"^(${places})$"]["name"](${bb});
  node["place"~"^(island)$"]["name"](${bb});
  node["place"~"^(sea|ocean)$"]["name"](${wide});
  node["natural"~"^(peak|volcano|bay|strait|cape|peninsula|valley|ridge|mountain_range|glacier)$"]["name"](${bb});
)->.n;
.n out body qt;
(
  way["natural"~"^(bay|strait|peninsula|cape|ridge|valley|mountain_range|glacier|water)$"]["name"](${bb});
  rel["natural"~"^(bay|strait|peninsula|ridge|valley|mountain_range|glacier|water)$"]["name"](${bb});
  way["place"~"^(island|sea)$"]["name"](${bb});
  rel["place"~"^(island|sea)$"]["name"](${bb});
  way["waterway"="river"]["name"](${bb});
  rel["boundary"="administrative"]["admin_level"~"^(2|4|6)$"]["name"](${bb});
)->.w;
.w out tags bb qt;`;
  const json = await overpass(q);
  const out = [];
  const rivers = new Map();
  for (const e of json.elements) {
    const t = e.tags || {};
    const name = t['name:en'] && /[^\x00-\x7F]/.test(t.name || '') ? t['name:en'] : t.name;
    if (!name) continue;
    const c = classify(t, e.type);
    if (!c) continue;
    const f = { id: `${e.type}/${e.id}`, type: e.type, osmId: e.id, name, ...c, rank: 0 };
    if (e.type === 'node') {
      f.point = toUV(b, e.lon, e.lat);
      if (c.kind === 'peak') f.rank = parseFloat(t.ele) || 0;
      else if (c.cat === 'city') {
        f.rank = parseInt(String(t.population || '').replace(/[^0-9]/g, ''), 10) || { city: 50000, town: 5000, village: 500 }[c.kind];
        if (t.capital === 'yes' || t.capital === '2' || t.capital === '4') f.rank *= 3;
      } else f.rank = 1;
    } else if (e.bounds) {
      const [u0, v1] = toUV(b, e.bounds.minlon, e.bounds.minlat);
      const [u1, v0] = toUV(b, e.bounds.maxlon, e.bounds.maxlat);
      f.bounds = [u0, v0, u1, v1];
      const iu = Math.max(0, Math.min(1, u1) - Math.max(0, u0));
      const iv = Math.max(0, Math.min(1, v1) - Math.max(0, v0));
      f.rank = iu * iv;
      if (c.kind === 'river') {
        const r = rivers.get(name);
        if (r) {
          r.bounds = [Math.min(r.bounds[0], u0), Math.min(r.bounds[1], v0), Math.max(r.bounds[2], u1), Math.max(r.bounds[3], v1)];
          r.ids.push(e.id);
          continue;
        }
        f.ids = [e.id];
        rivers.set(name, f);
      }
    } else continue;
    out.push(f);
  }
  for (const r of rivers.values()) {
    const [u0, v0, u1, v1] = r.bounds;
    r.rank = Math.hypot(Math.min(1, u1) - Math.max(0, u0), Math.min(1, v1) - Math.max(0, v0));
  }
  return out;
}

// Clipped feature geometry.
export async function fetchGeometry(b, features) {
  const ways = [];
  const rels = [];
  for (const f of features) {
    if (f.ids) ways.push(...f.ids);
    else if (f.type === 'way') ways.push(f.osmId);
    else if (f.type === 'relation') rels.push(f.osmId);
  }
  if (!ways.length && !rels.length) return new Map();
  const bb = bboxString(b);
  const q = `[out:json][timeout:90];
(${ways.length ? `way(id:${ways.join(',')});` : ''}${rels.length ? `rel(id:${rels.join(',')});` : ''});
out geom(${bb}) qt;`;
  const json = await overpass(q);
  const byElement = new Map();
  const lines = (geometry) => {
    const res = [];
    let cur = [];
    for (const p of geometry || []) {
      if (!p) {
        if (cur.length > 1) res.push(cur);
        cur = [];
        continue;
      }
      cur.push(toUV(b, p.lon, p.lat));
    }
    if (cur.length > 1) res.push(cur);
    return res;
  };
  for (const e of json.elements) {
    const key = `${e.type}/${e.id}`;
    if (e.type === 'way') byElement.set(key, lines(e.geometry));
    else if (e.type === 'relation') byElement.set(key, (e.members || []).flatMap((m) => lines(m.geometry)));
  }
  const out = new Map();
  for (const f of features) {
    const keys = f.ids ? f.ids.map((id) => `way/${id}`) : [f.id];
    out.set(f.id, keys.flatMap((k) => byElement.get(k) || []));
  }
  return out;
}

// Admin containment samples.
export async function fetchAdminSamples(b, G = 9) {
  let q = '[out:json][timeout:120];\n';
  for (let j = 0; j < G; j++) {
    for (let i = 0; i < G; i++) {
      const p = b.fromUV((i + 0.5) / G, (j + 0.5) / G);
      const { lng, lat } = worldToLngLat(p.x, p.y);
      q += `is_in(${lat.toFixed(5)},${lng.toFixed(5)})->.a;(area.a["boundary"="administrative"]["admin_level"~"^(2|4|6)$"];area.a["natural"~"^(peninsula|mountain_range|valley|glacier|ridge)$"];area.a["place"="island"];);out ids qt;make pt i=${j * G + i};out;\n`;
    }
  }
  const json = await overpass(q);
  const out = new Map();
  let pending = [];
  for (const e of json.elements) {
    if (e.type === 'area') {
      if (e.id > 3600000000) pending.push(`relation/${e.id - 3600000000}`);
    } else if (e.tags && e.tags.i !== undefined) {
      const k = parseInt(e.tags.i, 10);
      const uv = [((k % G) + 0.5) / G, (Math.floor(k / G) + 0.5) / G];
      for (const id of pending) {
        if (!out.has(id)) out.set(id, []);
        out.get(id).push(uv);
      }
      pending = [];
    }
  }
  return out;
}
