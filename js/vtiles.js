// Labels and boundaries from OpenFreeMap vector tiles.
import { VectorTile } from 'https://cdn.jsdelivr.net/npm/@mapbox/vector-tile@2.0.3/+esm';
import Pbf from 'https://cdn.jsdelivr.net/npm/pbf@4.0.1/+esm';

const TILEJSON = 'https://tiles.openfreemap.org/planet';
let tileUrl = null;

async function template() {
  if (!tileUrl) {
    const tj = await (await fetch(TILEJSON)).json();
    tileUrl = tj.tiles[0];
  }
  return tileUrl;
}

async function loadTiles(b, z) {
  const url = await template();
  const n = 2 ** z;
  const tx0 = Math.floor(b.x0 * n);
  const tx1 = Math.floor(b.x1 * n - 1e-9);
  const ty0 = Math.max(0, Math.floor(b.y0 * n));
  const ty1 = Math.min(n - 1, Math.floor(b.y1 * n - 1e-9));
  const jobs = [];
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const wx = ((tx % n) + n) % n;
      jobs.push(
        fetch(url.replace('{z}', z).replace('{x}', wx).replace('{y}', ty))
          .then((r) => (r.ok ? r.arrayBuffer() : null))
          .then((buf) => (buf ? { tx, ty, z, tile: new VectorTile(new Pbf(new Uint8Array(buf))) } : null))
          .catch(() => null),
      );
    }
  }
  return (await Promise.all(jobs)).filter(Boolean);
}

// Feature geometry in block coordinates.
function geometryUV(f, t, b) {
  const scale = 2 ** t.z;
  const ext = f.extent;
  return f.loadGeometry().map((ring) => ring.map((p) => b.toUV((t.tx + p.x / ext) / scale, (t.ty + p.y / ext) / scale)));
}

const inside = ([u, v], m = 0) => u >= -m && u <= 1 + m && v >= -m && v <= 1 + m;

// Label anchor on a line.
function lineMidInside(lines) {
  let best = null;
  let bestLen = 0;
  for (const line of lines) {
    let run = [];
    const flush = () => {
      let len = 0;
      for (let i = 1; i < run.length; i++) len += Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]);
      if (len > bestLen && run.length) [bestLen, best] = [len, run[Math.floor(run.length / 2)]];
      run = [];
    };
    for (const p of line) (inside(p) ? run.push(p) : flush());
    flush();
  }
  return best ? { point: best, length: bestLen } : null;
}

const WATER_KIND = { ocean: 'sea', sea: 'sea', lake: 'lake', bay: 'bay', strait: 'strait', lagoon: 'lake', reservoir: 'lake' };

// Vector tile data for a block.
export async function fetchTileData(b) {
  const span = Math.max(b.x1 - b.x0, b.y1 - b.y0);
  const z = Math.max(2, Math.min(14, Math.round(Math.log2(3 / span))));
  const zLow = Math.max(0, z - 3);
  const zBnd = Math.min(12, Math.max(z, 9));
  const [hiTiles, loTiles, bndTiles] = await Promise.all([loadTiles(b, z), loadTiles(b, zLow), zBnd === z ? null : loadTiles(b, zBnd)]);

  const features = [];
  const geom = new Map();
  const rivers = new Map();
  const seen = new Set();
  const add = (f) => {
    const key = `${f.kind}:${f.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    features.push(f);
  };

  for (const t of [...hiTiles, ...loTiles]) {
    const place = t.tile.layers.place;
    for (let i = 0; place && i < place.length; i++) {
      const f = place.feature(i);
      const p = f.properties;
      const name = p['name:en'] || p.name;
      if (!name || f.type !== 1) continue;
      const point = geometryUV(f, t, b)[0][0];
      const r = p.rank ?? 10;
      let kind = null;
      let cat = null;
      let rank = 0;
      if (p.class === 'country') [kind, cat, rank] = ['country', 'admin', 1];
      else if (p.class === 'state' || p.class === 'province') [kind, cat, rank] = ['state', 'admin', 1];
      else if (['city', 'town', 'village'].includes(p.class)) [kind, cat, rank] = [p.class, 'city', Math.pow(10, 7 - 0.35 * r)];
      else if (p.class === 'island') [kind, cat, rank] = ['island', 'feature', 0.02 / Math.max(1, r)];
      if (!kind || !inside(point, kind === 'state' || kind === 'country' ? 0 : -0.01)) continue;
      add({ id: `tile/place/${kind}/${name}`, source: 'tiles', name, kind, cat, point, rank });
    }

    const peaks = t.tile.layers.mountain_peak;
    for (let i = 0; peaks && i < peaks.length; i++) {
      const f = peaks.feature(i);
      const p = f.properties;
      const name = p['name:en'] || p.name;
      if (!name || f.type !== 1 || !['peak', 'volcano'].includes(p.class)) continue;
      const point = geometryUV(f, t, b)[0][0];
      const ele = Number(p.ele) || 0;
      if (!inside(point) || ele > 9000) continue;
      add({ id: `tile/peak/${name}`, source: 'tiles', name, kind: 'peak', cat: 'feature', point, rank: ele });
    }

    const water = t.tile.layers.water_name;
    for (let i = 0; water && i < water.length; i++) {
      const f = water.feature(i);
      const p = f.properties;
      const name = p['name:en'] || p.name;
      const kind = WATER_KIND[p.class];
      if (!name || !kind) continue;
      const lines = geometryUV(f, t, b);
      let point;
      let rank;
      if (f.type === 1) {
        point = lines[0][0];
        rank = kind === 'sea' ? 1 : 0.01;
        if (!inside(point) && kind !== 'sea') continue;
      } else {
        const mid = lineMidInside(lines);
        if (!mid) continue;
        point = mid.point;
        rank = Math.min(0.5, mid.length * mid.length);
      }
      add({ id: `tile/water/${name}`, source: 'tiles', name, kind, cat: 'water', point, rank });
    }

    const ww = t.tile.layers.waterway;
    for (let i = 0; ww && i < ww.length; i++) {
      const f = ww.feature(i);
      const p = f.properties;
      const name = p['name:en'] || p.name;
      if (!name || p.class !== 'river' || f.type !== 2) continue;
      const lines = geometryUV(f, t, b);
      const id = `tile/river/${name}`;
      if (!rivers.has(id)) rivers.set(id, { id, source: 'tiles', name, kind: 'river', cat: 'water', rank: 0 });
      geom.set(id, [...(geom.get(id) || []), ...lines]);
    }
  }
  for (const r of rivers.values()) {
    let len = 0;
    for (const line of geom.get(r.id)) {
      for (let i = 1; i < line.length; i++) if (inside(line[i]) && inside(line[i - 1])) len += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
    }
    if (len < 0.15) continue;
    r.rank = len;
    features.push(r);
  }

  const boundaries = [];
  for (const t of bndTiles || hiTiles) {
    const bl = t.tile.layers.boundary;
    for (let i = 0; bl && i < bl.length; i++) {
      const f = bl.feature(i);
      const p = f.properties;
      const level = Number(p.admin_level);
      if (![2, 4, 6].includes(level) || p.maritime) continue;
      for (const line of geometryUV(f, t, b)) if (line.some((q) => inside(q, 0.05))) boundaries.push({ level, points: line });
    }
  }
  return { features, geom, boundaries, zoom: z };
}
