// Elevation grid processing.

import { worldToLngLat } from './geo.js';

export function decodeTerrarium(canvas) {
  const { width: w, height: h } = canvas;
  const px = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const data = new Float32Array(w * h);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < w * h; i++) {
    if (px[i * 4 + 3] === 0) {
      data[i] = NaN;
      continue;
    }
    const e = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
    data[i] = e;
    sum += e;
    count++;
  }
  const fill = count ? sum / count : 0;
  for (let i = 0; i < data.length; i++) if (Number.isNaN(data[i])) data[i] = fill;
  return { w, h, data };
}

// Bilinear resample.
export function resample(g, nx, ny = nx) {
  const out = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    const fy = (j / (ny - 1)) * (g.h - 1);
    const y0 = Math.floor(fy);
    const y1 = Math.min(g.h - 1, y0 + 1);
    const ty = fy - y0;
    for (let i = 0; i < nx; i++) {
      const fx = (i / (nx - 1)) * (g.w - 1);
      const x0 = Math.floor(fx);
      const x1 = Math.min(g.w - 1, x0 + 1);
      const tx = fx - x0;
      const a = g.data[y0 * g.w + x0] * (1 - tx) + g.data[y0 * g.w + x1] * tx;
      const b = g.data[y1 * g.w + x0] * (1 - tx) + g.data[y1 * g.w + x1] * tx;
      out[j * nx + i] = a * (1 - ty) + b * ty;
    }
  }
  return { w: nx, h: ny, data: out };
}

// Resample onto a (possibly rotated) frame.
export function resampleFrame(g, frame, nx, ny) {
  if (!frame.angle) return resample(g, nx, ny);
  const out = new Float32Array(nx * ny);
  const sx = (g.w - 1) / (frame.x1 - frame.x0);
  const sy = (g.h - 1) / (frame.y1 - frame.y0);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const p = frame.fromUV(i / (nx - 1), j / (ny - 1));
      const fx = Math.min(g.w - 1, Math.max(0, (p.x - frame.x0) * sx));
      const fy = Math.min(g.h - 1, Math.max(0, (p.y - frame.y0) * sy));
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const x1 = Math.min(g.w - 1, x0 + 1);
      const y1 = Math.min(g.h - 1, y0 + 1);
      const tx = fx - x0;
      const ty = fy - y0;
      const a = g.data[y0 * g.w + x0] * (1 - tx) + g.data[y0 * g.w + x1] * tx;
      const b = g.data[y1 * g.w + x0] * (1 - tx) + g.data[y1 * g.w + x1] * tx;
      out[j * nx + i] = a * (1 - ty) + b * ty;
    }
  }
  return { w: nx, h: ny, data: out };
}

export function stats(g) {
  let min = Infinity;
  let max = -Infinity;
  for (const v of g.data) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

// Despike.
export function despike(g, threshold = 40) {
  const { w, h, data } = g;
  const out = data.slice();
  const nb = new Float32Array(9);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let k = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) nb[k++] = data[(y + dy) * w + x + dx];
      nb.sort();
      if (Math.abs(data[y * w + x] - nb[4]) > threshold) out[y * w + x] = nb[4];
    }
  }
  g.data = out;
  return g;
}

export function smooth(g, passes = 1) {
  const { w, h } = g;
  for (let p = 0; p < passes; p++) {
    const src = g.data;
    const out = new Float32Array(src.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0;
        let c = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            s += src[yy * w + xx];
            c++;
          }
        }
        out[y * w + x] = s / c;
      }
    }
    g.data = out;
  }
  return g;
}

// Distance to the nearest land cell.
function distanceToShore(mask, w, h) {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? INF : 0;
  const a = 1;
  const b = Math.SQRT2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + a);
      if (y > 0) {
        v = Math.min(v, d[i - w] + a);
        if (x > 0) v = Math.min(v, d[i - w - 1] + b);
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + b);
      }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!d[i]) continue;
      let v = d[i];
      if (x < w - 1) v = Math.min(v, d[i + 1] + a);
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + a);
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + b);
        if (x > 0) v = Math.min(v, d[i + w - 1] + b);
      }
      d[i] = v;
    }
  }
  return d;
}

// Max / min box filter.
function morph(src, w, h, r, dilate) {
  const pick = dilate ? Math.max : Math.min;
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = src[y * w + x];
      for (let k = -r; k <= r; k++) v = pick(v, src[y * w + Math.min(w - 1, Math.max(0, x + k))]);
      tmp[y * w + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = tmp[y * w + x];
      for (let k = -r; k <= r; k++) v = pick(v, tmp[Math.min(h - 1, Math.max(0, y + k)) * w + x]);
      out[y * w + x] = v;
    }
  }
  return out;
}

// Sea-level water mask.
export function waterMask(g, waterLevel, { lakesOnly = false, tolerance = 3, lum = null, maxLum = 0.3 } = {}) {
  const { w, h, data } = g;
  const mask = new Uint8Array(w * h);
  const cand = new Uint8Array(w * h);
  const seed = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const v = data[i];
      if (Math.abs(v - waterLevel) > tolerance) continue;
      cand[i] = 1;
      let lo = v;
      let hi = v;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nv = data[Math.min(h - 1, Math.max(0, y + dy)) * w + Math.min(w - 1, Math.max(0, x + dx))];
          if (nv < lo) lo = nv;
          if (nv > hi) hi = nv;
        }
      }
      if (hi - lo <= 1.01) seed[i] = 1;
    }
  }
  const closed = morph(morph(seed, w, h, 2, true), w, h, 2, false);
  const stack = [];
  for (let i = 0; i < seed.length; i++) {
    if (seed[i] || (closed[i] && cand[i])) {
      mask[i] = 1;
      stack.push(i);
    }
  }
  const limit = waterLevel + tolerance;
  while (stack.length) {
    const i = stack.pop();
    const x = i % w;
    const y = (i - x) / w;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const j = yy * w + xx;
      if (!mask[j] && data[j] < limit) {
        mask[j] = 1;
        stack.push(j);
      }
    }
  }
  if (lum) dropBrightBodies(mask, w, h, lum, maxLum);
  if (!lakesOnly) for (let i = 0; i < data.length; i++) if (data[i] < waterLevel) mask[i] = 1;
  return mask;
}

// Drop bright water bodies.
function dropBrightBodies(mask, w, h, lum, maxLum) {
  const seen = new Uint8Array(w * h);
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || seen[s]) continue;
    const cells = [s];
    seen[s] = 1;
    let sum = 0;
    for (let k = 0; k < cells.length; k++) {
      const i = cells[k];
      sum += lum[i];
      const x = i % w;
      const y = (i - x) / w;
      if (x > 0 && mask[i - 1] && !seen[i - 1]) (seen[i - 1] = 1), cells.push(i - 1);
      if (x < w - 1 && mask[i + 1] && !seen[i + 1]) (seen[i + 1] = 1), cells.push(i + 1);
      if (y > 0 && mask[i - w] && !seen[i - w]) (seen[i - w] = 1), cells.push(i - w);
      if (y < h - 1 && mask[i + w] && !seen[i + w]) (seen[i + w] = 1), cells.push(i + w);
    }
    if (sum / cells.length > maxLum) for (const i of cells) mask[i] = 0;
  }
}

// ---------- water model ----------

// Connected components.
function components(mask, w, h) {
  const id = new Int32Array(w * h).fill(-1);
  const sizes = [];
  const stack = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || id[s] >= 0) continue;
    const c = sizes.length;
    let n = 0;
    id[s] = c;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop();
      n++;
      const x = i % w;
      if (x > 0 && mask[i - 1] && id[i - 1] < 0) (id[i - 1] = c), stack.push(i - 1);
      if (x < w - 1 && mask[i + 1] && id[i + 1] < 0) (id[i + 1] = c), stack.push(i + 1);
      if (i >= w && mask[i - w] && id[i - w] < 0) (id[i - w] = c), stack.push(i - w);
      if (i < w * (h - 1) && mask[i + w] && id[i + w] < 0) (id[i + w] = c), stack.push(i + w);
    }
    sizes.push(n);
  }
  return { id, sizes };
}

function removeSmall(mask, w, h, minCells) {
  const { id, sizes } = components(mask, w, h);
  for (let i = 0; i < mask.length; i++) if (mask[i] && sizes[id[i]] < minCells) mask[i] = 0;
}

function localRange(data, w, h, x, y) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const v = data[Math.min(h - 1, Math.max(0, y + dy)) * w + Math.min(w - 1, Math.max(0, x + dx))];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  return [lo, hi];
}

// Fallback water mask.
function detectFlatWater(g, lum, out, exclude) {
  const { w, h, data } = g;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (exclude[i] || (lum && lum[i] > 0.28)) continue;
      const [lo, hi] = localRange(data, w, h, x, y);
      if (hi - lo <= 0.5) out[i] = 1;
    }
  }
  removeSmall(out, w, h, 20);
}

// Inland water surface heights.
function inlandSurface(g, inland, surface) {
  const { w, h, data } = g;
  const val = new Float32Array(w * h).fill(NaN);
  const queue = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!inland[i]) continue;
      const shore =
        (x > 0 && !inland[i - 1]) || (x < w - 1 && !inland[i + 1]) || (y > 0 && !inland[i - w]) || (y < h - 1 && !inland[i + w]);
      const [lo, hi] = localRange(data, w, h, x, y);
      if (hi - lo <= 1.0) val[i] = data[i];
      else if (shore) val[i] = lo;
      if (!Number.isNaN(val[i])) queue.push(i);
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const x = i % w;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
      if (j < 0 || j >= w * h || !inland[j] || !Number.isNaN(val[j])) continue;
      val[j] = val[i];
      queue.push(j);
    }
  }
  for (let p = 0; p < 4; p++) {
    const src = val.slice();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!inland[i] || Number.isNaN(src[i])) continue;
        let s = 0;
        let c = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            const v = src[yy * w + xx];
            if (inland[yy * w + xx] && !Number.isNaN(v)) (s += v), c++;
          }
        }
        val[i] = s / c;
      }
    }
  }
  for (let i = 0; i < val.length; i++) if (inland[i] && !Number.isNaN(val[i])) surface[i] = val[i];
}

// Water model.
export function computeWater(g, o) {
  const { w, h, data } = g;
  const n = w * h;
  const ocean = o.ocean ? waterMask(g, o.seaLevel, { lakesOnly: false, lum: o.lum }) : new Uint8Array(n);
  const inland = new Uint8Array(n);
  if (o.occurrence) {
    for (let i = 0; i < n; i++) if (!ocean[i] && o.occurrence[i] >= o.occThreshold) inland[i] = 1;
    removeSmall(inland, w, h, 4);
  } else if (o.detectFlat) {
    detectFlatWater(g, o.lum, inland, ocean);
  }

  const mask = new Uint8Array(n);
  const surface = new Float32Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (ocean[i]) {
      mask[i] = 1;
      surface[i] = o.seaLevel;
    } else if (inland[i]) mask[i] = 1;
  }
  inlandSurface(g, inland, surface);

  const dist = distanceToShore(mask, w, h);
  const scale = Math.max(w, h) * 0.05;
  const depth = { w, h, data: new Float32Array(n) };
  let flat = 0;
  let water = 0;
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    water++;
    const real = Math.max(0, surface[i] - data[i]);
    if (real < 1.5) flat++;
    const synthetic = o.synthDepth * (1 - Math.exp(-dist[i] / scale));
    depth.data[i] = Math.max(real, synthetic);
  }
  smooth(depth, Math.max(2, Math.round((2 * Math.max(w, h)) / 512)));

  const bed = data.slice();
  const depths = [];
  for (let i = 0; i < n; i++) {
    if (!mask[i]) {
      depth.data[i] = 0;
      continue;
    }
    const d = Math.max(0.3, depth.data[i]);
    depth.data[i] = d;
    bed[i] = surface[i] - d;
    if (i % 7 === 0) depths.push(d);
  }
  depths.sort((a, b) => a - b);
  const depthRef = Math.max(1, depths.length ? depths[Math.floor(depths.length * 0.95)] : 1);
  return { mask, surface, bed: { w, h, data: bed }, depth: depth.data, depthRef, flatFraction: water ? flat / n : 0 };
}

// Decode surface-water occurrence tiles.
export function decodeOccurrence(canvas) {
  const { width: w, height: h } = canvas;
  const px = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const data = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = px[i * 4];
    const b = px[i * 4 + 2];
    data[i] = px[i * 4 + 3] > 0 ? (100 * b) / Math.max(1, r + b) : 0;
  }
  return { w, h, data };
}

// Hillshade.
export function hillshade(g, cellSize, zFactor = 1, azimuth = 315, altitude = 45) {
  const { w, h, data } = g;
  const out = new Float32Array(w * h);
  const az = ((360 - azimuth + 90) * Math.PI) / 180;
  const zen = ((90 - altitude) * Math.PI) / 180;
  const at = (x, y) => data[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dzdx = ((at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1))) / (8 * cellSize);
      const dzdy = ((at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1))) / (8 * cellSize);
      const slope = Math.atan(zFactor * Math.hypot(dzdx, dzdy));
      const aspect = Math.atan2(dzdy, -dzdx);
      const v = Math.cos(zen) * Math.cos(slope) + Math.sin(zen) * Math.sin(slope) * Math.cos(az - aspect);
      out[y * w + x] = Math.max(0, v);
    }
  }
  return out;
}

// ---------- custom GeoTIFF ----------

let geotiffLib = null;

export async function loadGeoTiff(file) {
  geotiffLib ??= await import('https://cdn.jsdelivr.net/npm/geotiff@2.1.3/+esm');
  const tiff = await geotiffLib.fromArrayBuffer(await file.arrayBuffer());
  const image = await tiff.getImage();
  const keys = image.getGeoKeys() || {};
  const epsg = keys.ProjectedCSTypeGeoKey || keys.GeographicTypeGeoKey || 4326;
  if (![4326, 4269, 3857, 900913].includes(epsg)) {
    throw new Error(`GeoTIFF is EPSG:${epsg}. Reproject it to EPSG:4326 or EPSG:3857 first (e.g. gdalwarp -t_srs EPSG:4326).`);
  }
  return {
    name: file.name,
    image,
    epsg,
    bbox: image.getBoundingBox(),
    width: image.getWidth(),
    height: image.getHeight(),
    nodata: image.getGDALNoData(),
  };
}

// Merge a GeoTIFF into the grid.
export async function mergeGeoTiff(g, b, tif, { scale = 1, offset = 0 } = {}) {
  const toCrs = (lng, lat) => {
    if (tif.epsg === 3857 || tif.epsg === 900913) {
      const R = 6378137;
      return [(lng * Math.PI * R) / 180, R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))];
    }
    return [lng, lat];
  };
  const [minX, minY, maxX, maxY] = tif.bbox;
  const toPix = (cx, cy) => [((cx - minX) / (maxX - minX)) * tif.width, ((maxY - cy) / (maxY - minY)) * tif.height];

  const nw = worldToLngLat(b.x0, b.y0);
  const se = worldToLngLat(b.x1, b.y1);
  const [ax, ay] = toPix(...toCrs(nw.lng, nw.lat));
  const [bx, by] = toPix(...toCrs(se.lng, se.lat));
  const win = [
    Math.max(0, Math.floor(Math.min(ax, bx)) - 1),
    Math.max(0, Math.floor(Math.min(ay, by)) - 1),
    Math.min(tif.width, Math.ceil(Math.max(ax, bx)) + 1),
    Math.min(tif.height, Math.ceil(Math.max(ay, by)) + 1),
  ];
  if (win[2] <= win[0] || win[3] <= win[1]) return 0;

  const rw = Math.min(win[2] - win[0], 2048);
  const rh = Math.min(win[3] - win[1], 2048);
  const [raster] = await tif.image.readRasters({ window: win, width: rw, height: rh, samples: [0] });
  const sx = rw / (win[2] - win[0]);
  const sy = rh / (win[3] - win[1]);
  const nodata = tif.nodata;
  const valid = (v) => Number.isFinite(v) && v !== nodata && Math.abs(v) < 1e5;

  let replaced = 0;
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      const wp = b.fromUV ? b.fromUV(i / (g.w - 1), j / (g.h - 1)) : { x: b.x0 + (i / (g.w - 1)) * (b.x1 - b.x0), y: b.y0 + (j / (g.h - 1)) * (b.y1 - b.y0) };
      const { lng, lat } = worldToLngLat(wp.x, wp.y);
      const [px, py] = toPix(...toCrs(lng, lat));
      const fx = (px - win[0]) * sx - 0.5;
      const fy = (py - win[1]) * sy - 0.5;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      if (x0 < 0 || y0 < 0 || x0 + 1 >= rw || y0 + 1 >= rh) continue;
      const v00 = raster[y0 * rw + x0];
      const v10 = raster[y0 * rw + x0 + 1];
      const v01 = raster[(y0 + 1) * rw + x0];
      const v11 = raster[(y0 + 1) * rw + x0 + 1];
      if (!(valid(v00) && valid(v10) && valid(v01) && valid(v11))) continue;
      const tx = fx - x0;
      const ty = fy - y0;
      const v = (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
      g.data[j * g.w + i] = v * scale + offset;
      replaced++;
    }
  }
  return replaced;
}
