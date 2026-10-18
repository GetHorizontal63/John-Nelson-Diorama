// Map labels.
import * as THREE from 'three';

const FONTS = {
  serif: '"Cinzel", Georgia, serif',
  sans: '"Raleway", "Helvetica Neue", Arial, sans-serif',
};

// Label styles.
const STYLES = {
  country: { font: 'serif', upper: true, spacing: 0.55, gradient: true, shadow: true, color: '#ffffff', size: 3.2 },
  state: { font: 'serif', upper: true, spacing: 0.55, gradient: true, shadow: true, color: '#ffffff', size: 2.6 },
  county: { font: 'sans', weight: 300, upper: true, spacing: 0.4, shadow: true, color: 'rgba(255,255,255,0.62)', size: 0.9 },
  water: { font: 'serif', upper: true, spacing: 0.65, skew: -0.18, glow: true, color: 'rgba(222,246,255,0.88)', size: 1.6 },
  river: { font: 'serif', spacing: 0.12, skew: -0.18, glow: true, color: 'rgba(212,242,255,0.92)', size: 0.85 },
  landform: { font: 'serif', upper: true, spacing: 0.45, shadow: true, color: 'rgba(255,255,255,0.9)', size: 1.4 },
  city: { font: 'sans', weight: 500, spacing: 0.03, halo: true, marker: 'dot', color: '#ffffff', size: 1.1, sprite: true },
  peak: { font: 'serif', weight: 400, spacing: 0.05, halo: true, marker: 'triangle', color: '#ffffff', size: 0.9, sprite: true },
};

const LIMITS = { country: 4, state: 6, county: 30, sea: 4, lake: 6, bay: 3, strait: 2, river: 4, city: 9, town: 8, village: 5, peak: 5, island: 4, peninsula: 3, cape: 1, ridge: 2, valley: 2, mountain_range: 3, glacier: 2 };

// Dark-ink label styles.
function inkStyle(st, ink) {
  if (ink !== 'dark') return st;
  const alpha = /rgba\([^)]*,\s*([0-9.]+)\)/.exec(st.color || '')?.[1] ?? '1';
  const water = /222,246,255|212,242,255/.test(st.color || '');
  return { ...st, dark: true, color: water ? `rgba(18,62,104,${alpha})` : `rgba(28,28,32,${alpha})` };
}

// ---------- text rendering ----------

function measureSpaced(ctx, chars, sp) {
  return chars.reduce((s, ch) => s + ctx.measureText(ch).width, 0) + sp * Math.max(0, chars.length - 1);
}

// Text canvas.
export function textCanvas(text, st, fontKey = st.font) {
  const px = st.sprite ? 64 : 96;
  const font = `${st.weight || 400} ${px}px ${FONTS[fontKey] || FONTS.serif}`;
  const chars = [...(st.upper ? text.toUpperCase() : text)];
  const c = document.createElement('canvas');
  let ctx = c.getContext('2d');
  ctx.font = font;
  const sp = px * (st.spacing || 0);
  const tw = measureSpaced(ctx, chars, sp);
  const skew = st.skew || 0;
  const padX = px * 0.45 + Math.abs(skew) * px;
  const lineH = px * 1.5;
  const markerH = st.marker ? px * 0.75 : 0;
  const scale = Math.min(1, (4096 - padX * 2) / tw);
  c.width = Math.ceil(tw * scale + padX * 2);
  c.height = Math.ceil(lineH + markerH);
  ctx = c.getContext('2d');
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  const cy = lineH / 2;
  const drawText = (mode) => {
    ctx.save();
    ctx.translate(padX, cy);
    ctx.transform(scale, 0, skew * scale, 1, -skew * cy, 0);
    let x = 0;
    for (const ch of chars) {
      if (mode === 'stroke') ctx.strokeText(ch, x, 0);
      else ctx.fillText(ch, x, 0);
      x += ctx.measureText(ch).width + sp;
    }
    ctx.restore();
  };

  const ink = st.dark ? '28,28,32' : '255,255,255';
  if (st.halo) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = px * 0.16;
    ctx.strokeStyle = st.dark ? 'rgba(255,255,255,0.7)' : 'rgba(10,14,18,0.55)';
    drawText('stroke');
  }
  if (st.gradient) {
    const g = ctx.createLinearGradient(0, cy - px * 0.5, 0, cy + px * 0.5);
    g.addColorStop(0, `rgba(${ink},1)`);
    g.addColorStop(1, `rgba(${ink},0.45)`);
    ctx.fillStyle = g;
  } else ctx.fillStyle = st.color;
  if (st.shadow) {
    ctx.shadowColor = st.dark ? 'rgba(0,0,0,0.22)' : 'rgba(0,0,0,0.55)';
    ctx.shadowOffsetY = px * 0.09;
    ctx.shadowBlur = px * 0.08;
  } else if (st.glow) {
    ctx.shadowColor = 'rgba(0,40,90,0.6)';
    ctx.shadowBlur = px * 0.18;
  }
  drawText('fill');
  ctx.shadowColor = 'transparent';

  if (st.marker) {
    const mx = c.width / 2;
    const my = lineH + markerH / 2;
    const r = px * 0.17;
    ctx.fillStyle = st.markerColor || (st.dark ? '#1c1c20' : '#ffffff');
    ctx.strokeStyle = st.dark ? 'rgba(255,255,255,0.8)' : 'rgba(10,14,18,0.7)';
    ctx.lineWidth = px * 0.06;
    ctx.beginPath();
    if (st.marker === 'triangle') {
      ctx.moveTo(mx, my - r * 1.2);
      ctx.lineTo(mx + r * 1.15, my + r * 0.8);
      ctx.lineTo(mx - r * 1.15, my + r * 0.8);
      ctx.closePath();
    } else ctx.arc(mx, my, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  return { canvas: c, aspect: c.width / c.height, capFrac: (px * 0.72) / c.height, anchor: st.marker ? markerH / 2 / c.height : 0.5 };
}

// Upright billboard label.
export function makeSprite(text, st, letterH, track) {
  const r = textCanvas(text, st);
  const tex = track(new THREE.CanvasTexture(r.canvas));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const sprite = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false })));
  const h = letterH / r.capFrac;
  sprite.scale.set(h * r.aspect, h, 1);
  sprite.center.set(0.5, r.anchor);
  sprite.renderOrder = 20;
  return { sprite, width: h * r.aspect, height: h };
}

export const CITY_STYLE = STYLES.city;

// ---------- placement ----------

const styleFor = (f) => {
  if (f.kind === 'country' || f.kind === 'state' || f.kind === 'county') return STYLES[f.kind];
  if (f.kind === 'river') return STYLES.river;
  if (f.cat === 'water') return STYLES.water;
  if (f.cat === 'city') return STYLES.city;
  if (f.kind === 'peak') return STYLES.peak;
  return STYLES.landform;
};

function letterHeight(f) {
  const st = styleFor(f);
  const r = Math.sqrt(Math.max(0, f.rank || 0));
  switch (f.kind) {
    case 'lake':
      return Math.min(2.6, 0.9 + 3.5 * r);
    case 'sea':
      return 2.6;
    case 'bay':
    case 'strait':
      return Math.min(1.8, 0.9 + 2 * r);
    case 'town':
      return 0.95;
    case 'village':
      return 0.8;
    case 'island':
    case 'peninsula':
    case 'mountain_range':
    case 'glacier':
      return Math.min(2.2, 0.8 + 3 * r);
    default:
      return st.size;
  }
}

function priority(f) {
  const r = f.rank || 0;
  switch (f.kind) {
    case 'country': return 100;
    case 'state': return 90 + r;
    case 'sea': return 88;
    case 'lake': return 55 + 35 * Math.sqrt(r);
    case 'city': return 70 + Math.log10(r + 1);
    case 'town': return 48 + Math.log10(r + 1);
    case 'village': return 28 + Math.log10(r + 1);
    case 'peak': return 44 + r / 1000;
    case 'bay':
    case 'strait': return 50 + 20 * r;
    case 'county': return 24 + r;
    case 'river': return 34 + 10 * r;
    default: return 40 + 30 * Math.sqrt(r);
  }
}

// Nearest matching cell.
function nearestCell(u, v, rect, pred, steps = 24) {
  const [u0, v0, u1, v1] = rect;
  let best = null;
  let bestD = Infinity;
  for (let j = 0; j <= steps; j++) {
    for (let i = 0; i <= steps; i++) {
      const cu = u0 + ((u1 - u0) * i) / steps;
      const cv = v0 + ((v1 - v0) * j) / steps;
      if (!pred(cu, cv)) continue;
      const d = (cu - u) ** 2 + (cv - v) ** 2;
      if (d < bestD) [best, bestD] = [[cu, cv], d];
    }
  }
  return best;
}

// Distance field.
function distanceField(G, pred) {
  const inside = new Uint8Array(G * G);
  const dist = new Float32Array(G * G).fill(Infinity);
  const queue = [];
  for (let k = 0; k < G * G; k++) {
    inside[k] = pred(((k % G) + 0.5) / G, (Math.floor(k / G) + 0.5) / G) ? 1 : 0;
    if (!inside[k]) (dist[k] = 0), queue.push(k);
  }
  for (let q = 0; q < queue.length; q++) {
    const k = queue[q];
    const i = k % G;
    for (const n of [i > 0 ? k - 1 : -1, i < G - 1 ? k + 1 : -1, k - G, k + G]) {
      if (n < 0 || n >= G * G || dist[n] <= dist[k] + 1) continue;
      dist[n] = dist[k] + 1;
      queue.push(n);
    }
  }
  return { inside, dist };
}

// Land area label position.
function placeOnLand(rect, field, G) {
  const [u0, v0, u1, v1] = rect;
  const cu = (u0 + u1) / 2;
  const cv = (v0 + v1) / 2;
  let best = null;
  let bestS = -Infinity;
  for (let k = 0; k < G * G; k++) {
    if (!field.inside[k]) continue;
    const u = ((k % G) + 0.5) / G;
    const v = (Math.floor(k / G) + 0.5) / G;
    if (u < u0 || u > u1 || v < v0 || v > v1) continue;
    const s = Math.min(field.dist[k], 8) - 6 * Math.hypot(u - cu, v - cv);
    if (s > bestS) [bestS, best] = [s, [u, v]];
  }
  return best;
}

// Admin area label position.
function placeInSamples(samples, field, G, S) {
  const own = new Set(samples.map(([u, v]) => Math.floor(v * S) * S + Math.floor(u * S)));
  const mu = samples.reduce((s, p) => s + p[0], 0) / samples.length;
  const mv = samples.reduce((s, p) => s + p[1], 0) / samples.length;
  let best = null;
  let bestS = -Infinity;
  for (let k = 0; k < G * G; k++) {
    if (!field.inside[k]) continue;
    const u = ((k % G) + 0.5) / G;
    const v = (Math.floor(k / G) + 0.5) / G;
    if (!own.has(Math.floor(v * S) * S + Math.floor(u * S))) continue;
    const s = Math.min(field.dist[k], 8) - 10 * Math.hypot(u - mu, v - mv);
    if (s > bestS) [bestS, best] = [s, [u, v]];
  }
  return best;
}

// Water body label positions.
function placeWaterBodies(bodies, geom, waterAt) {
  const G = 64;
  const water = new Uint8Array(G * G);
  const dist = new Float32Array(G * G).fill(Infinity);
  const queue = [];
  for (let j = 0; j < G; j++) {
    for (let i = 0; i < G; i++) {
      const k = j * G + i;
      water[k] = waterAt((i + 0.5) / G, (j + 0.5) / G) ? 1 : 0;
      if (!water[k]) (dist[k] = 0), queue.push(k);
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const k = queue[q];
    const i = k % G;
    for (const n of [i > 0 ? k - 1 : -1, i < G - 1 ? k + 1 : -1, k - G, k + G]) {
      if (n < 0 || n >= G * G || dist[n] <= dist[k] + 1) continue;
      dist[n] = dist[k] + 1;
      queue.push(n);
    }
  }
  const pts = bodies.map((f) => {
    const lines = geom.get(f.id) || [];
    const all = lines.flat();
    const stride = Math.max(1, Math.floor(all.length / 250));
    return all.filter((_, i) => i % stride === 0);
  });
  const owner = new Int16Array(G * G).fill(-1);
  for (let k = 0; k < G * G; k++) {
    if (!water[k]) continue;
    const u = ((k % G) + 0.5) / G;
    const v = (Math.floor(k / G) + 0.5) / G;
    let best = -1;
    let bestD = Infinity;
    pts.forEach((list, b) => {
      for (const [pu, pv] of list) {
        const d = (pu - u) ** 2 + (pv - v) ** 2;
        if (d < bestD) [bestD, best] = [d, b];
      }
    });
    owner[k] = best;
  }
  return bodies.map((f, b) => {
    const [u0, v0, u1, v1] = f.bounds || [0, 0, 1, 1];
    let best = null;
    let bestD = 0;
    for (let k = 0; k < G * G; k++) {
      if (owner[k] !== b || !pts[b].length) continue;
      const u = ((k % G) + 0.5) / G;
      const v = (Math.floor(k / G) + 0.5) / G;
      if (u < u0 || u > u1 || v < v0 || v > v1) continue;
      if (dist[k] > bestD) [bestD, best] = [dist[k], [u, v]];
    }
    return best;
  });
}

// River label position.
function placeRiver(lines, W, D) {
  const dist = (a, b) => Math.hypot((b[0] - a[0]) * W, (b[1] - a[1]) * D);
  let bestChain = null;
  let bestLen = 0;
  for (const line of lines) {
    let chain = [];
    const flush = () => {
      let len = 0;
      for (let i = 1; i < chain.length; i++) len += dist(chain[i - 1], chain[i]);
      if (len > bestLen) [bestLen, bestChain] = [len, chain];
      chain = [];
    };
    for (const p of line) {
      if (p[0] > 0.03 && p[0] < 0.97 && p[1] > 0.03 && p[1] < 0.97) chain.push(p);
      else flush();
    }
    flush();
  }
  if (!bestChain) return null;
  let acc = 0;
  for (let i = 1; i < bestChain.length; i++) {
    const a = bestChain[i - 1];
    const b = bestChain[i];
    const seg = dist(a, b);
    if (acc + seg >= bestLen / 2) {
      const t = (bestLen / 2 - acc) / seg;
      const i0 = Math.max(0, i - 4);
      const i1 = Math.min(bestChain.length - 1, i + 3);
      const angle = Math.atan2((bestChain[i1][1] - bestChain[i0][1]) * D, (bestChain[i1][0] - bestChain[i0][0]) * W);
      return { point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], angle, length: bestLen };
    }
    acc += seg;
  }
  return null;
}

// Label layer.
export function buildLabels(features, geom, built, opts) {
  const group = new THREE.Group();
  const disposables = [];
  const track = (x) => (disposables.push(x), x);
  const flats = [];

  const show = (f) =>
    (f.cat === 'admin' && opts.show.admin) ||
    (f.cat === 'county' && opts.show.county) ||
    (f.cat === 'city' && opts.show.city) ||
    (f.cat === 'feature' && opts.show.feature) ||
    (f.cat === 'water' && opts.show.water);

  const overrides = opts.overrides || new Map();
  const ov = (f) => overrides.get(labelKey(f)) || {};

  const byKind = new Map();
  let offshore = null;
  for (const f0 of features) {
    let f = f0;
    let auto = show(f);
    if (f.kind === 'sea' && f.point && (f.point[0] < 0 || f.point[0] > 1 || f.point[1] < 0 || f.point[1] > 1)) {
      const d = Math.hypot(f.point[0] - 0.5, f.point[1] - 0.5);
      if (!offshore || d < offshore.d) offshore = { f, d };
      continue;
    }
    if (f.bounds) {
      const [u0, v0, u1, v1] = f.bounds;
      if (u1 < 0 || v1 < 0 || u0 > 1 || v0 > 1) continue;
      if ((f.cat === 'admin' || f.cat === 'county') && u0 <= 0 && v0 <= 0 && u1 >= 1 && v1 >= 1) auto = false;
      if (f.kind === 'lake' && f.rank < 0.003) auto = false;
      if (f.kind === 'island' && f.rank < 0.0015) auto = false;
    } else if (f.point) {
      const [u, v] = f.point;
      if (u < 0 || v < 0 || u > 1 || v > 1) continue;
      if (u < 0.02 || v < 0.02 || u > 0.98 || v > 0.98) auto = false;
    }
    if (!byKind.has(f.kind)) byKind.set(f.kind, []);
    byKind.get(f.kind).push({ f, auto });
  }
  if (offshore) {
    if (!byKind.has('sea')) byKind.set('sea', []);
    byKind.get('sea').push({ f: { ...offshore.f, offshore: true, rank: 1 }, auto: show(offshore.f) && !byKind.get('sea').length });
  }

  let cands = [];
  const catalog = [];
  for (const [kind, list] of byKind) {
    const best = new Map();
    for (const c of list) {
      const o = best.get(c.f.name);
      const better = !o || (c.f.source === 'tiles' && o.f.source !== 'tiles') || (c.f.source === o.f.source && c.f.rank > o.f.rank);
      if (better) best.set(c.f.name, { f: c.f, auto: c.auto || (o?.auto ?? false) });
    }
    const sorted = [...best.values()].sort((a, b) => b.f.rank - a.f.rank);
    let autoCount = 0;
    for (const { f, auto } of sorted) {
      const o = ov(f);
      const forced = o.mode === 'on';
      const locked = opts.lock?.get(f.cat);
      const pickAuto = auto && o.mode !== 'off' && (locked ? locked.has(labelKey(f)) : autoCount < (LIMITS[kind] ?? 4));
      if (pickAuto) autoCount++;
      if (forced || pickAuto) cands.push(Object.assign(f, { forced, userUV: o.uv || null }));
      catalog.push({ key: labelKey(f), name: f.name, kind, cat: f.cat, rank: f.rank, mode: o.mode || 'auto', moved: !!o.uv });
    }
  }

  const waterBodies = cands.filter((f) => f.cat === 'water' && f.kind !== 'river' && f.bounds && !f.offshore);
  const waterPts = geom.size ? placeWaterBodies(waterBodies, geom, built.waterAt) : [];
  const landField = distanceField(64, (u, v) => !built.waterAt(u, v));
  const openWater = distanceField(64, (u, v) => built.waterAt(u, v));
  const placed = [];
  for (const f of cands) {
    let point = f.point;
    let angle = null;
    if (f.userUV) {
      point = f.userUV;
      if (f.kind === 'river') {
        const r = placeRiver(geom.get(f.id) || [], built.width, built.depth);
        angle = r ? r.angle : null;
      }
    } else if (f.offshore) {
      point = placeOnLand([0.05, 0.05, 0.95, 0.95], openWater, 64);
      if (!point || openWater.dist[Math.floor(point[1] * 64) * 64 + Math.floor(point[0] * 64)] < 4) continue;
    } else if (f.bounds && f.cat !== 'water' && opts.adminSamples) {
      const samples = opts.adminSamples.get(f.id);
      point = samples?.length ? placeInSamples(samples, landField, 64, opts.adminGrid || 9) : null;
      if (!point && !f.forced) continue;
    } else if (f.kind === 'river') {
      const r = placeRiver(geom.get(f.id) || [], built.width, built.depth);
      if (r) {
        point = r.point;
        angle = r.angle;
        f.maxLength = r.length * 0.9;
      } else if (!f.forced) continue;
    } else if (f.bounds) {
      const [u0, v0, u1, v1] = f.bounds;
      const rect = [Math.max(0.04, u0), Math.max(0.04, v0), Math.min(0.96, u1), Math.min(0.96, v1)];
      const c = [(rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2];
      if (f.cat === 'water') {
        const wi = waterBodies.indexOf(f);
        point = (wi >= 0 && waterPts[wi]) || nearestCell(c[0], c[1], rect, built.waterAt);
      } else point = placeOnLand(rect, landField, 64) || c;
    }
    if (!point && f.forced && f.bounds) {
      const [u0, v0, u1, v1] = f.bounds;
      point = [(Math.max(0.05, u0) + Math.min(0.95, u1)) / 2, (Math.max(0.05, v0) + Math.min(0.95, v1)) / 2];
    }
    if (!point) continue;
    placed.push({ f, point, angle, prio: priority(f) + (f.forced || f.userUV ? 1000 : 0) });
  }
  placed.sort((a, b) => b.prio - a.prio);

  const cam = opts.camera;
  cam.updateMatrixWorld();
  const look = new THREE.Vector3();
  cam.getWorldDirection(look);
  look.y = 0;
  if (look.lengthSq() < 1e-6) look.set(0, 0, -1);
  look.normalize();
  const right = new THREE.Vector3(-look.z, 0, look.x);
  const camRight = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
  const camUp = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
  const v3 = new THREE.Vector3();
  const screenBox = (pts, pad = 0.008) => {
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [px, py, pz] of pts) {
      v3.set(px, py, pz).project(cam);
      const sx = v3.x * cam.aspect;
      b[0] = Math.min(b[0], sx);
      b[1] = Math.min(b[1], v3.y);
      b[2] = Math.max(b[2], sx);
      b[3] = Math.max(b[3], v3.y);
    }
    return [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad];
  };
  const boxes = [];
  const overlaps = (b) => boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);
  for (const pts of opts.reserved || []) boxes.push(screenBox(pts));

  const fullLook = new THREE.Vector3();
  const pitch = (camera) => {
    if (opts.orient === 'stand') return 0;
    if (opts.orient === 'flat' || !opts.orient) return -Math.PI / 2;
    camera.getWorldDirection(fullLook);
    const elev = Math.asin(Math.max(-1, Math.min(1, -fullLook.y)));
    return -Math.min(Math.PI / 2, elev + (Number(opts.orient) * Math.PI) / 180);
  };
  const rx0 = pitch(cam);

  for (const { f, point, angle } of placed) {
    const st = inkStyle(styleFor(f), opts.ink);
    const L = letterHeight(f) * opts.size;
    let { x, z } = built.toLocal(point[0], point[1]);
    const y = built.topAt(point[0], point[1]);

    if (st.sprite) {
      const s = makeSprite(f.name, st, L, track);
      const a = s.sprite.center.y;
      const corner = (sr, su) => [x + camRight.x * sr + camUp.x * su, y + camRight.y * sr + camUp.y * su, z + camRight.z * sr + camUp.z * su];
      const box = screenBox([corner(-s.width / 2, -a * s.height), corner(s.width / 2, -a * s.height), corner(-s.width / 2, (1 - a) * s.height), corner(s.width / 2, (1 - a) * s.height)]);
      if (!f.forced && !f.userUV && overlaps(box)) continue;
      boxes.push(box);
      s.sprite.position.set(x, y + 0.05, z);
      s.sprite.userData = { name: f.name, key: labelKey(f), box, label: true };
      group.add(s.sprite);
      continue;
    }

    const r = textCanvas(f.name, st, opts.font === 'sans' && st.font === 'serif' ? 'sans' : st.font);
    let h = L / r.capFrac;
    let w = h * r.aspect;
    if (f.maxLength && w > f.maxLength) {
      const k = f.maxLength / w;
      if (k < 0.5) continue;
      w *= k;
      h *= k;
    }
    const ax = angle !== null ? [Math.cos(angle), Math.sin(angle)] : [right.x, right.z];
    const ay = [-ax[1], ax[0]];

    if (f.bounds && f.cat !== 'water' && angle === null && !f.userUV) {
      const landFrac = (px, pz) => {
        let n = 0;
        for (let t = -4; t <= 4; t++) {
          const [u, v] = built.toUV(px + (ax[0] * w * t) / 8, pz + (ax[1] * w * t) / 8);
          if (u >= 0 && u <= 1 && v >= 0 && v <= 1 && !built.waterAt(u, v)) n++;
        }
        return n / 9;
      };
      if (landFrac(x, z) < 0.75) {
        const [u0, v0, u1, v1] = f.bounds;
        const samples = opts.adminSamples?.get(f.id);
        const S = opts.adminGrid || 9;
        const own = samples?.length ? new Set(samples.map(([su, sv]) => Math.floor(sv * S) * S + Math.floor(su * S))) : null;
        const w0 = w;
        let found = null;
        for (const k of [1, 0.8, 0.6]) {
          w = w0 * k;
          let best = null;
          let bestS = -Infinity;
          for (let c = 0; c < 64 * 64; c += 2) {
            if (!landField.inside[c]) continue;
            const u = ((c % 64) + 0.5) / 64;
            const v = (Math.floor(c / 64) + 0.5) / 64;
            if (u < Math.max(0, u0) || u > Math.min(1, u1) || v < Math.max(0, v0) || v > Math.min(1, v1)) continue;
            if (own && !own.has(Math.floor(v * S) * S + Math.floor(u * S))) continue;
            const q = built.toLocal(u, v);
            const sc = landFrac(q.x, q.z) * 10 - Math.hypot(q.x - x, q.z - z) * 0.05;
            if (sc > bestS) [bestS, best] = [sc, q];
          }
          if (best && bestS > 6.5) {
            found = { ...best, k };
            break;
          }
        }
        if (found) {
          ({ x, z } = found);
          w = w0 * found.k;
          h *= found.k;
        } else w = w0;
      }
    }
    const halfX = built.width / 2 - 1;
    const halfZ = built.depth / 2 - 1;
    const extent = () => [Math.abs(ax[0]) * w / 2 + Math.abs(ay[0]) * h / 2, Math.abs(ax[1]) * w / 2 + Math.abs(ay[1]) * h / 2];
    let [ex, ez] = extent();
    const fit = Math.min(1, halfX / ex, halfZ / ez);
    if (fit < 0.6) continue;
    w *= fit;
    h *= fit;
    [ex, ez] = extent();
    const cx = Math.max(-halfX + ex, Math.min(halfX - ex, x));
    const cz = Math.max(-halfZ + ez, Math.min(halfZ - ez, z));
    const cy = Math.max(y, built.topAt(...built.toUV(cx, cz))) + 0.3;
    const cr = Math.cos(rx0);
    const sr = Math.sin(rx0);
    const corners = [-1, 1].flatMap((sx) =>
      [-1, 1].map((sy) => {
        const ly = (sy * h) / 2;
        const py = ly * cr + (h / 2) * cr * cr;
        const pz = ly * sr + (h / 2) * cr * sr;
        return [cx + (ax[0] * w * sx) / 2 + ay[0] * pz, cy + py, cz + (ax[1] * w * sx) / 2 + ay[1] * pz];
      }),
    );
    const box = screenBox(corners);
    if (!f.forced && !f.userUV && overlaps(box)) continue;
    boxes.push(box);

    const tex = track(new THREE.CanvasTexture(r.canvas));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const mesh = new THREE.Mesh(
      track(new THREE.PlaneGeometry(w, h)),
      track(new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false })),
    );
    mesh.renderOrder = 15;
    const holder = new THREE.Object3D();
    holder.add(mesh);
    holder.position.set(cx, cy, cz);
    holder.userData = { angle, name: f.name, key: labelKey(f), box, halfH: h / 2, label: true };
    group.add(holder);
    flats.push(holder);
  }

  const update = (camera) => {
    camera.getWorldDirection(look);
    const dx = look.x;
    const dz = look.z;
    const rx = pitch(camera);
    for (const h of flats) {
      const mesh = h.children[0];
      const lift = h.userData.halfH * Math.cos(rx);
      mesh.rotation.x = rx;
      mesh.position.set(0, Math.cos(rx) * lift, Math.sin(rx) * lift);
      const a = h.userData.angle;
      if (a === null) h.rotation.y = Math.atan2(-dx, -dz);
      else {
        const readable = Math.cos(a) * -dz + Math.sin(a) * dx >= 0;
        h.rotation.y = -a + (readable ? 0 : Math.PI);
      }
    }
  };
  update(cam);

  const placedKeys = new Set(group.children.map((c) => c.userData.key));
  for (const c of catalog) c.placed = placedKeys.has(c.key);

  return {
    group,
    count: group.children.length,
    catalog,
    update,
    dispose() {
      disposables.forEach((d) => d.dispose());
    },
  };
}

// Label key.
export function labelKey(f) {
  return `${f.kind}:${f.name}`;
}

// Features that need geometry.
export function geometryTargets(features) {
  const water = features.filter((f) => f.cat === 'water' && f.bounds && f.kind !== 'river').sort((a, b) => b.rank - a.rank).slice(0, 10);
  const rivers = features.filter((f) => f.kind === 'river').sort((a, b) => b.rank - a.rank).slice(0, 6);
  return [...water, ...rivers];
}
