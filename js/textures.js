// Procedural and composited textures.

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smoothstep = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;
const mixRgb = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

function canvas2d(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })];
}

// ---------- noise ----------

function hash(x, y, seed) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const mod = (a, n) => ((a % n) + n) % n;

// Tileable value noise.
function vnoise(x, y, px, py, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const x0 = mod(xi, px);
  const x1 = mod(xi + 1, px);
  const y0 = mod(yi, py);
  const y1 = mod(yi + 1, py);
  const a = hash(x0, y0, seed);
  const b = hash(x1, y0, seed);
  const c = hash(x0, y1, seed);
  const d = hash(x1, y1, seed);
  return mix(mix(a, b, u), mix(c, d, u), v);
}

function fbm(x, y, px, py, octaves, seed) {
  let s = 0;
  let amp = 0.5;
  let f = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    s += amp * vnoise(x * f, y * f, px * f, py * f, seed + o * 17);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return s / norm;
}

// ---------- surface ----------

export const WATER = {
  shallow: [70, 214, 226],
  deep: [8, 46, 140],
};

// Terrain surface texture.
export function makeSurface(imagery, hi, opts) {
  const maxSize = opts.maxSize || 4096;
  const k = Math.min(1, maxSize / Math.max(imagery.width, imagery.height));
  const w = Math.round(imagery.width * k);
  const h = Math.round(imagery.height * k);
  const [out, ctx] = canvas2d(w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(imagery, 0, 0, w, h);

  // Depth tint
  if (opts.depth && opts.tint > 0) {
    const ref = opts.depthRef || 1;
    const fadeDepth = Math.max(1, ref * 0.05);
    const [tc, tctx] = canvas2d(hi.w, hi.h);
    const id = tctx.createImageData(hi.w, hi.h);
    for (let i = 0; i < hi.data.length; i++) {
      if (!opts.mask[i]) continue;
      const depth = opts.depth[i];
      const t = Math.pow(clamp01(depth / ref), 0.6);
      const [r, g, b] = mixRgb(WATER.shallow, WATER.deep, t);
      id.data[i * 4] = r;
      id.data[i * 4 + 1] = g;
      id.data[i * 4 + 2] = b;
      id.data[i * 4 + 3] = 255 * opts.tint * smoothstep(0, fadeDepth, depth);
    }
    tctx.putImageData(id, 0, 0);
    ctx.drawImage(tc, 0, 0, w, h);
  }

  // Hillshade
  if (opts.hillshade && opts.hsStrength > 0) {
    const [hc, hctx] = canvas2d(hi.w, hi.h);
    const id = hctx.createImageData(hi.w, hi.h);
    for (let i = 0; i < opts.hillshade.length; i++) {
      const v = Math.round(opts.hillshade[i] * 255);
      id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v;
      id.data[i * 4 + 3] = 255;
    }
    hctx.putImageData(id, 0, 0);
    ctx.globalCompositeOperation = 'soft-light';
    let s = opts.hsStrength;
    while (s > 0) {
      ctx.globalAlpha = Math.min(1, s);
      ctx.drawImage(hc, 0, 0, w, h);
      s -= 1;
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // Colour grade
  if (opts.saturation !== 1 || opts.contrast !== 1) {
    const [gc, gctx] = canvas2d(w, h);
    gctx.filter = `saturate(${opts.saturation}) contrast(${opts.contrast})`;
    gctx.drawImage(out, 0, 0);
    return gc;
  }
  return out;
}

// Boundary styles.
const BOUNDARY_STYLE = {
  6: { width: 0.0012, color: 'rgba(255,255,255,0.7)', dash: [0.005, 0.004], glow: 0.003 },
  4: { width: 0.0022, color: 'rgba(255,255,255,0.88)', dash: [0.014, 0.006, 0.003, 0.006], glow: 0.006 },
  2: { width: 0.0032, color: 'rgba(255,255,255,0.95)', dash: [], glow: 0.01 },
};

// Boundaries.
export function drawBoundaries(ctx, w, h, lines) {
  if (!lines?.length) return;
  const s = Math.max(w, h);
  for (const level of [6, 4, 2]) {
    const st = BOUNDARY_STYLE[level];
    const group = lines.filter((l) => l.level === level);
    if (!group.length) continue;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const path = new Path2D();
    for (const l of group) {
      l.points.forEach(([u, v], i) => (i ? path.lineTo(u * w, v * h) : path.moveTo(u * w, v * h)));
    }
    if (st.glow) {
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = st.width * s + st.glow * s;
      ctx.filter = `blur(${Math.max(1, st.glow * s * 0.4)}px)`;
      ctx.stroke(path);
      ctx.filter = 'none';
    }
    ctx.strokeStyle = st.color;
    ctx.lineWidth = Math.max(1, st.width * s);
    ctx.setLineDash(st.dash.map((d) => d * s));
    ctx.stroke(path);
    ctx.restore();
  }
}

// ---------- rock walls ----------

export const WALL_THEMES = {
  sandstone: { label: 'Sandstone (orange)', top: [255, 178, 92], mid: [228, 112, 38], bottom: [96, 30, 20], strata: 0.35, blocky: 0.7 },
  limestone: { label: 'Limestone (cream to orange)', top: [246, 238, 220], mid: [232, 176, 112], bottom: [214, 96, 40], strata: 0.55, blocky: 0.35 },
  basalt: { label: 'Basalt (charcoal)', top: [150, 142, 136], mid: [86, 80, 78], bottom: [30, 28, 30], strata: 0.15, blocky: 0.9 },
  clay: { label: 'Red clay', top: [222, 120, 84], mid: [176, 68, 44], bottom: [70, 22, 22], strata: 0.8, blocky: 0.2 },
};

// Tinted rock palette.
export function tintedTheme(baseKey, hex) {
  const base = WALL_THEMES[baseKey] || WALL_THEMES.sandstone;
  const n = parseInt(hex.replace('#', ''), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return { ...base, top: mixRgb(c, [255, 255, 255], 0.45), mid: c, bottom: mixRgb(c, [0, 0, 0], 0.6) };
}

// Rock texture.
export function makeRockTexture(theme, w = 2048, h = 512, seed = 7) {
  theme = typeof theme === 'object' ? theme : WALL_THEMES[theme] || WALL_THEMES.sandstone;
  const H = new Float32Array(w * h);
  const PX = 16;
  const PY = 4;
  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const base = fbm(u * PX, v * PY, PX, PY, 6, seed);
      const warp = fbm(u * 6, v * 2, 6, 2, 3, seed + 99);
      const bed = v * 5 + warp * 1.6;
      const bedFrac = bed - Math.floor(bed);
      const ledge = smoothstep(0.0, 0.18, bedFrac) * (1 - smoothstep(0.82, 1.0, bedFrac));
      const jx = u * 22 + fbm(u * 4, v * 6, 4, 6, 3, seed + 5) * 3.5;
      const jFrac = jx - Math.floor(jx);
      const joint = smoothstep(0.0, 0.06, jFrac) * (1 - smoothstep(0.94, 1.0, jFrac));
      const blockId = hash(mod(Math.floor(jx), 22), Math.floor(bed), seed);
      H[y * w + x] =
        base * 0.6 +
        ledge * theme.strata * 0.35 +
        joint * theme.blocky * 0.25 +
        blockId * theme.blocky * 0.15;
    }
  }

  const [c, ctx] = canvas2d(w, h);
  const id = ctx.createImageData(w, h);
  const at = (x, y) => H[Math.min(h - 1, Math.max(0, y)) * w + mod(x, w)];
  for (let y = 0; y < h; y++) {
    const v = y / (h - 1);
    const col = v < 0.45 ? mixRgb(theme.top, theme.mid, v / 0.45) : mixRgb(theme.mid, theme.bottom, (v - 0.45) / 0.55);
    for (let x = 0; x < w; x++) {
      const dx = at(x + 1, y) - at(x - 1, y);
      const dy = at(x, y + 1) - at(x, y - 1);
      const shade = clamp01(0.62 - dx * 9 - dy * 9 + (H[y * w + x] - 0.5) * 0.6);
      const rim = 1 + 0.35 * (1 - smoothstep(0, 0.04, v));
      const f = (0.45 + 0.85 * shade) * rim;
      const i = (y * w + x) * 4;
      id.data[i] = Math.min(255, col[0] * f);
      id.data[i + 1] = Math.min(255, col[1] * f);
      id.data[i + 2] = Math.min(255, col[2] * f);
      id.data[i + 3] = 255;
    }
  }
  ctx.putImageData(id, 0, 0);
  return c;
}

// ---------- water caustics ----------

export function makeCausticTexture(size = 512, cells = 9, seed = 3) {
  const pts = [];
  for (let cy = 0; cy < cells; cy++) {
    for (let cx = 0; cx < cells; cx++) {
      pts.push([(cx + hash(cx, cy, seed)) / cells, (cy + hash(cx, cy, seed + 1)) / cells]);
    }
  }
  const [c, ctx] = canvas2d(size, size);
  const id = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const gx = Math.floor(u * cells);
      const gy = Math.floor(v * cells);
      let f1 = 9;
      let f2 = 9;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const cx = gx + ox;
          const cy = gy + oy;
          const p = pts[mod(cy, cells) * cells + mod(cx, cells)];
          const px = p[0] + Math.floor(cx / cells);
          const py = p[1] + Math.floor(cy / cells);
          const d = Math.hypot(px - u, py - v);
          if (d < f1) [f2, f1] = [f1, d];
          else if (d < f2) f2 = d;
        }
      }
      const edge = (f2 - f1) * cells;
      const a = 1 - smoothstep(0.0, 0.1, edge);
      const i = (y * size + x) * 4;
      id.data[i] = id.data[i + 1] = id.data[i + 2] = 255;
      id.data[i + 3] = 255 * a;
    }
  }
  ctx.putImageData(id, 0, 0);
  return c;
}

// ---------- soft drop shadow ----------

export function makeShadowTexture(size = 256) {
  const [c, ctx] = canvas2d(size, size);
  const id = ctx.createImageData(size, size);
  const inner = 0.3;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = Math.abs(x / size - 0.5);
      const v = Math.abs(y / size - 0.5);
      const dx = Math.max(u - inner, 0);
      const dy = Math.max(v - inner, 0);
      const d = Math.hypot(dx, dy) + Math.min(Math.max(u - inner, v - inner), 0);
      const a = 1 - smoothstep(-0.05, 0.2, d);
      const i = (y * size + x) * 4;
      id.data[i] = id.data[i + 1] = id.data[i + 2] = 255;
      id.data[i + 3] = 255 * a * a * 0.85;
    }
  }
  ctx.putImageData(id, 0, 0);
  return c;
}

// ---------- spaced lettering for wall labels ----------

export function makeLetteringTexture(text, { color = 'rgba(255,240,225,0.6)', font = '"Cinzel", Georgia, serif' } = {}) {
  const w = 2048;
  const h = 128;
  const [c, ctx] = canvas2d(w, h);
  const chars = [...text.toUpperCase()];
  if (!chars.length) return c;
  ctx.font = `400 ${h * 0.62}px ${font}`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const pad = w * 0.04;
  const step = chars.length > 1 ? (w - 2 * pad) / (chars.length - 1) : 0;
  chars.forEach((ch, i) => ctx.fillText(ch, chars.length > 1 ? pad + i * step : w / 2, h / 2));
  return c;
}
