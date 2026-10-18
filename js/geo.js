// Web Mercator helpers and tile mosaics.

export const TILE = 256;
const EARTH_CIRCUMFERENCE = 40075016.686;

export const SOURCES = {
  dem: {
    maxZoom: 15,
    url: (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,
  },
  imagery: {
    maxZoom: 17,
    url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
  },
  water: {
    maxZoom: 13,
    tries: 1,
    url: (z, x, y) => `https://storage.googleapis.com/global-surface-water/tiles2021/occurrence/${z}/${x}/${y}.png`,
  },
};

export function lngLatToWorld(lng, lat) {
  const s = Math.sin((Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180);
  return {
    x: (lng + 180) / 360,
    y: 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI),
  };
}

export function worldToLngLat(x, y) {
  return {
    lng: x * 360 - 180,
    lat: (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI,
  };
}

// Selection frame.
export function makeFrame({ cx, cy, w, h, angle = 0 }) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const ex = [c, s];
  const ey = [-s, c];
  const fromUV = (u, v) => ({
    x: cx + ex[0] * (u - 0.5) * w + ey[0] * (v - 0.5) * h,
    y: cy + ex[1] * (u - 0.5) * w + ey[1] * (v - 0.5) * h,
  });
  const toUV = (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    return [(dx * ex[0] + dy * ex[1]) / w + 0.5, (dx * ey[0] + dy * ey[1]) / h + 0.5];
  };
  const corners = [fromUV(0, 0), fromUV(1, 0), fromUV(1, 1), fromUV(0, 1)];
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  return {
    cx,
    cy,
    w,
    h,
    angle,
    ex,
    ey,
    x0: Math.min(...xs),
    y0: Math.max(0, Math.min(...ys)),
    x1: Math.max(...xs),
    y1: Math.min(1, Math.max(...ys)),
    corners,
    fromUV,
    toUV,
    lngLatToUV: (lng, lat) => {
      const p = lngLatToWorld(lng, lat);
      return toUV(p.x, p.y);
    },
    with: (patch) => makeFrame({ cx, cy, w, h, angle, ...patch }),
  };
}

// Ground size in metres.
export function bboxSizeMeters(b) {
  const cx = b.cx ?? (b.x0 + b.x1) / 2;
  const cy = b.cy ?? (b.y0 + b.y1) / 2;
  const { lat } = worldToLngLat(cx, cy);
  const k = EARTH_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180);
  return { w: (b.w ?? b.x1 - b.x0) * k, h: (b.h ?? b.y1 - b.y0) * k };
}

// Ground width in metres.
export function bboxSideMeters(b) {
  return bboxSizeMeters(b).w;
}

export function rectAround(cx, cy, wWorld, hWorld = wWorld, angle = 0) {
  return makeFrame({ cx, cy, w: wWorld, h: hWorld, angle });
}

export function squareAround(cx, cy, sideWorld) {
  return rectAround(cx, cy, sideWorld, sideWorld);
}

// Rectangle of a given aspect and area.
export function rectFromLngLat(lng, lat, sizeKm, aspect = 1) {
  const c = lngLatToWorld(lng, lat);
  const side = (sizeKm * 1000) / (EARTH_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180));
  return rectAround(c.x, c.y, side * Math.sqrt(aspect), side / Math.sqrt(aspect));
}

// Crop a canvas to a frame.
export function canvasToFrame(canvas, frame) {
  const scale = canvas.width / (frame.x1 - frame.x0);
  const W = Math.max(1, Math.round(frame.w * scale));
  const H = Math.max(1, Math.round(frame.h * scale));
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const ccx = (frame.cx - frame.x0) * scale;
  const ccy = (frame.cy - frame.y0) * scale;
  const [ex, ey] = [frame.ex, frame.ey];
  ctx.setTransform(ex[0], ey[0], ex[1], ey[1], W / 2 - (ex[0] * ccx + ex[1] * ccy), H / 2 - (ey[0] * ccx + ey[1] * ccy));
  ctx.drawImage(canvas, 0, 0);
  return out;
}

function tileRange(b, z) {
  const n = 2 ** z;
  return {
    tx0: Math.floor(b.x0 * n),
    tx1: Math.floor(b.x1 * n - 1e-9),
    ty0: Math.max(0, Math.floor(b.y0 * n)),
    ty1: Math.min(n - 1, Math.floor(b.y1 * n - 1e-9)),
  };
}

function tileCount(b, z) {
  const r = tileRange(b, z);
  return (r.tx1 - r.tx0 + 1) * (r.ty1 - r.ty0 + 1);
}

export function pickZoom(b, targetPx, maxZoom, maxTiles = 160) {
  let z = Math.round(Math.log2(targetPx / ((b.x1 - b.x0) * TILE)));
  z = Math.max(0, Math.min(maxZoom, z));
  while (z > 0 && tileCount(b, z) > maxTiles) z--;
  return z;
}

function loadImage(url, tries = 3) {
  return new Promise((resolve) => {
    const attempt = (left) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => (left > 1 ? setTimeout(() => attempt(left - 1), 400) : resolve(null));
      img.src = url;
    };
    attempt(tries);
  });
}

// Tile mosaic.
export async function fetchMosaic(source, b, z, onProgress = () => {}) {
  const n = 2 ** z;
  const scale = n * TILE;
  const px0 = b.x0 * scale;
  const py0 = b.y0 * scale;
  const w = Math.max(1, Math.round((b.x1 - b.x0) * scale));
  const h = Math.max(1, Math.round((b.y1 - b.y0) * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;

  const r = tileRange(b, z);
  const jobs = [];
  for (let ty = r.ty0; ty <= r.ty1; ty++) {
    for (let tx = r.tx0; tx <= r.tx1; tx++) jobs.push({ tx, ty });
  }

  const total = jobs.length;
  let done = 0;
  let failed = 0;
  const worker = async () => {
    while (jobs.length) {
      const { tx, ty } = jobs.shift();
      const wx = ((tx % n) + n) % n;
      const img = await loadImage(source.url(z, wx, ty), source.tries ?? 3);
      if (img) ctx.drawImage(img, Math.round(tx * TILE - px0), Math.round(ty * TILE - py0));
      else failed++;
      onProgress(++done, total);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  return { canvas, zoom: z, failed };
}
