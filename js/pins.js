// Map pins.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeSprite, CITY_STYLE } from './labels.js';
import { imageHeadGeometry } from './pinimage.js';

export const MAX_PINS = 5000;
export const MAX_PIN_LABELS = 150;

export const PIN_STYLES = {
  drop: 'Drop pin',
  pushpin: 'Push pin',
  flag: 'Flag',
  sphere: 'Floating sphere',
  diamond: 'Floating diamond',
  beacon: 'Light beacon',
  ring: 'Ground ring',
  image: 'Custom image (PNG)',
};

// ---------- parsing ----------

function splitRow(line, delim) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') (cur += '"'), i++;
      else q = !q;
    } else if (ch === delim && !q) (out.push(cur.trim()), (cur = ''));
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

const COLS = {
  lat: /^(lat|latitude|y)$/i,
  lon: /^(lon|lng|long|longitude|x)$/i,
  name: /^(name|label|title|place|location)$/i,
  color: /^(colou?r|hex)$/i,
  style: /^(style|marker|icon|symbol|type)$/i,
  size: /^(size|scale)$/i,
};

// Parse pins from CSV / TSV text.
export function parsePins(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'));
  if (!lines.length) return { pins: [], errors: [], truncated: 0 };
  const first = lines[0];
  const delim = first.includes('\t') ? '\t' : first.split(';').length > first.split(',').length ? ';' : ',';
  const head = splitRow(first, delim);
  const hasHeader = head.some((h) => COLS.lat.test(h)) && head.some((h) => COLS.lon.test(h));
  const idx = { lat: 0, lon: 1, name: 2, color: 3, style: 4, size: 5 };
  if (hasHeader) {
    for (const k of Object.keys(idx)) idx[k] = head.findIndex((h) => COLS[k].test(h));
  }
  const pins = [];
  const errors = [];
  const rows = hasHeader ? lines.slice(1) : lines;
  rows.forEach((line, n) => {
    const r = splitRow(line, delim);
    const lat = parseFloat(r[idx.lat]);
    const lon = parseFloat(r[idx.lon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      errors.push(`row ${n + (hasHeader ? 2 : 1)}: needs valid latitude and longitude`);
      return;
    }
    const style = (r[idx.style] || '').toLowerCase();
    pins.push({
      lat,
      lon,
      name: idx.name >= 0 ? r[idx.name] || '' : '',
      color: idx.color >= 0 && /^#?[0-9a-f]{3,8}$|^[a-z]+$/i.test(r[idx.color] || '') ? r[idx.color] : null,
      style: PIN_STYLES[style] ? style : null,
      size: idx.size >= 0 ? parseFloat(r[idx.size]) || null : null,
    });
  });
  const truncated = Math.max(0, pins.length - MAX_PINS);
  return { pins: pins.slice(0, MAX_PINS), errors, truncated };
}

// ---------- marker geometry ----------

function teardrop(n) {
  const R = 0.3;
  const cy = 0.95;
  const phi = Math.asin(R / cy);
  const L = Math.sqrt(cy * cy - R * R);
  const T = [L * Math.sin(phi), L * Math.cos(phi)];
  const pts = [new THREE.Vector2(0.0001, 0), new THREE.Vector2(T[0], T[1])];
  const b0 = Math.atan2(T[1] - cy, T[0]);
  const rows = n(16);
  for (let i = 1; i <= rows; i++) {
    const a = b0 + ((Math.PI / 2 - b0) * i) / rows;
    pts.push(new THREE.Vector2(Math.max(0.0001, R * Math.cos(a)), cy + R * Math.sin(a)));
  }
  return new THREE.LatheGeometry(pts, n(28));
}

const at = (g, x, y, z) => (g.translate(x, y, z), g);

// Marker parts per style.
function styleParts(style, detail = 1) {
  const n = (k) => Math.max(4, Math.round(k * detail));
  switch (style) {
    case 'pushpin':
      return {
        color: [at(new THREE.SphereGeometry(0.16, n(20), n(14)), 0, 0.78, 0), at(new THREE.CylinderGeometry(0.07, 0.11, 0.12, n(20)), 0, 0.62, 0)],
        metal: [at(new THREE.CylinderGeometry(0.018, 0.004, 0.58, n(8)), 0, 0.29, 0)],
        shadow: true,
      };
    case 'flag': {
      const flag = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 1.1, 0), new THREE.Vector3(0.5, 0.95, 0), new THREE.Vector3(0, 0.8, 0)]);
      flag.computeVertexNormals();
      return {
        color: [flag],
        metal: [at(new THREE.CylinderGeometry(0.02, 0.02, 1.12, n(8)), 0, 0.56, 0), at(new THREE.SphereGeometry(0.04, n(10), n(8)), 0, 1.13, 0)],
        shadow: true,
        doubleSided: true,
      };
    }
    case 'sphere':
      return {
        color: [at(new THREE.SphereGeometry(0.22, n(24), n(16)), 0, 0.62, 0)],
        metal: [at(new THREE.CylinderGeometry(0.012, 0.012, 0.42, n(6)), 0, 0.21, 0)],
        shadow: true,
      };
    case 'diamond': {
      const d = new THREE.OctahedronGeometry(0.24, 0);
      d.scale(1, 1.6, 1);
      return { color: [at(d, 0, 0.75, 0)], metal: [at(new THREE.CylinderGeometry(0.012, 0.012, 0.38, n(6)), 0, 0.19, 0)], shadow: true };
    }
    case 'beacon':
      return {
        glow: [at(new THREE.CylinderGeometry(0.06, 0.1, 2.6, n(16), 1, true), 0, 1.3, 0)],
        color: [at(new THREE.SphereGeometry(0.11, n(16), n(12)), 0, 0.06, 0)],
        shadow: false,
      };
    case 'ring': {
      const ring = new THREE.TorusGeometry(0.32, 0.05, n(10), n(40));
      ring.rotateX(Math.PI / 2);
      return { color: [at(ring, 0, 0.06, 0), at(new THREE.SphereGeometry(0.08, n(14), n(10)), 0, 0.08, 0)], shadow: false };
    }
    case 'drop':
    default:
      return { color: [teardrop(n)], white: [at(new THREE.SphereGeometry(0.11, n(16), n(12)), 0, 0.95, 0.24)], shadow: true };
  }
}

// Pin meshes.
export function buildPins(pins, bbox, built, opts) {
  const group = new THREE.Group();
  const disposables = [];
  const track = (x) => (disposables.push(x), x);
  const inside = [];
  for (const p of pins) {
    const [u, v] = bbox.lngLatToUV(p.lon, p.lat);
    if (u >= 0 && u <= 1 && v >= 0 && v <= 1) inside.push({ ...p, u, v });
  }

  const byStyle = new Map();
  for (const p of inside) {
    let s = p.style || opts.style;
    if (s === 'image' && !opts.image?.img) s = 'drop';
    if (!byStyle.has(s)) byStyle.set(s, []);
    byStyle.get(s).push(p);
  }

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const color = new THREE.Color();
  const materials = {
    color: (double) => track(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.1, side: double ? THREE.DoubleSide : THREE.FrontSide })),
    metal: () => track(new THREE.MeshStandardMaterial({ color: 0xc9ccd1, roughness: 0.3, metalness: 0.8 })),
    white: () => track(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 })),
    glow: () => track(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })),
  };

  const pinColor = (p) => {
    try {
      color.set(p.color ? (p.color.startsWith('#') || !/^[0-9a-f]+$/i.test(p.color) ? p.color : `#${p.color}`) : opts.color);
    } catch {
      color.set(opts.color);
    }
    return color;
  };

  // ---- custom image heads ----
  const facing = [];
  let imageTop = 1.1;
  const imageList = byStyle.get('image');
  byStyle.delete('image');
  if (imageList) {
    const io = opts.image;
    const detail = imageList.length > 2000 ? 0.4 : imageList.length > 600 ? 0.65 : 1;
    const head = imageHeadGeometry(io.img, detail, io.depth);
    const lift = io.stem ? 0.42 : 0.02;
    imageTop = lift + head.height + 0.08;
    const solid = io.colours === 'solid';
    const capMat = track(new THREE.MeshStandardMaterial(solid ? { color: 0xffffff, roughness: 0.45 } : { map: io.img.texture, roughness: 0.55 }));
    const sideMat = track(new THREE.MeshStandardMaterial({ color: solid ? 0xb4b4b4 : io.img.avg.clone().multiplyScalar(0.7), roughness: 0.6 }));
    const base = imageList.map((p) => {
      const s = opts.size * (p.size || 1);
      const { x, z } = built.toLocal(p.u, p.v);
      return { x, y: built.topAt(p.u, p.v), z, s };
    });
    for (const [g, mat, tinted] of [[head.caps, capMat, solid], [head.sides, sideMat, solid]]) {
      const geo = track(g.clone().translate(0, lift, 0));
      const mesh = new THREE.InstancedMesh(geo, mat, imageList.length);
      if (tinted) imageList.forEach((p, i) => mesh.setColorAt(i, pinColor(p)));
      group.add(mesh);
      facing.push(mesh);
    }
    if (io.stem) {
      const sg = track(new THREE.CylinderGeometry(0.014, 0.014, lift + 0.02, 6).translate(0, (lift + 0.02) / 2, 0));
      const stem = new THREE.InstancedMesh(sg, materials.metal(), imageList.length);
      base.forEach((b, i) => stem.setMatrixAt(i, m.compose(pos.set(b.x, b.y, b.z), q, scl.set(b.s, b.s, b.s))));
      group.add(stem);
    }
    byStyle.set('image', imageList);
    facing.base = base;
  }

  for (const [style, list] of byStyle) {
    if (style === 'image') {
      addShadow(list);
      continue;
    }
    const parts = styleParts(style, list.length > 2000 ? 0.4 : list.length > 600 ? 0.65 : 1);
    for (const kind of ['color', 'metal', 'white', 'glow']) {
      if (!parts[kind]) continue;
      const geo = track(mergeGeometries(parts[kind].map((g) => (g.index ? g.toNonIndexed() : g))));
      const mesh = new THREE.InstancedMesh(geo, materials[kind](parts.doubleSided), list.length);
      list.forEach((p, i) => {
        const s = opts.size * (p.size || 1);
        const { x, z } = built.toLocal(p.u, p.v);
        pos.set(x, built.topAt(p.u, p.v), z);
        scl.set(s, s, s);
        mesh.setMatrixAt(i, m.compose(pos, q, scl));
        if (kind === 'color' || kind === 'glow') mesh.setColorAt(i, pinColor(p));
      });
      if (kind === 'glow') mesh.renderOrder = 6;
      group.add(mesh);
    }
    if (parts.shadow) addShadow(list);
  }

  function addShadow(list) {
    const sg = track(new THREE.CircleGeometry(0.22, list.length > 600 ? 12 : 24));
    sg.rotateX(-Math.PI / 2);
    const sh = new THREE.InstancedMesh(sg, track(new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false })), list.length);
    list.forEach((p, i) => {
      const s = opts.size * (p.size || 1);
      const { x, z } = built.toLocal(p.u, p.v);
      pos.set(x + 0.08 * s, built.topAt(p.u, p.v) + 0.04, z + 0.08 * s);
      scl.set(s, s, s);
      sh.setMatrixAt(i, m.compose(pos, q, scl));
    });
    sh.renderOrder = 5;
    group.add(sh);
  }

  // Pin names
  let labelled = 0;
  if (opts.labels) {
    const st = { ...CITY_STYLE, marker: null };
    for (const p of inside) {
      if (!p.name || labelled >= MAX_PIN_LABELS) continue;
      const s = opts.size * (p.size || 1);
      const { sprite } = makeSprite(p.name, st, 0.9 * Math.max(0.6, opts.size / 2.4), track);
      const { x, z } = built.toLocal(p.u, p.v);
      const top = { beacon: 0.5, ring: 0.4, flag: 1.25, drop: 1.35, image: imageTop }[p.style || opts.style] ?? 1.1;
      sprite.center.set(0.5, 0.1);
      sprite.position.set(x, built.topAt(p.u, p.v) + top * s, z);
      group.add(sprite);
      labelled++;
    }
  }

  return {
    group,
    shown: inside.length,
    outside: pins.length - inside.length,
    labelsCapped: opts.labels && inside.filter((p) => p.name).length > MAX_PIN_LABELS,
    face(yaw) {
      if (!facing.length || Math.abs(yaw - (facing.yaw ?? 1e9)) < 0.003) return;
      facing.yaw = yaw;
      const rq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      facing.base.forEach((b, i) => {
        m.compose(pos.set(b.x, b.y, b.z), rq, scl.set(b.s, b.s, b.s));
        for (const mesh of facing) mesh.setMatrixAt(i, m);
      });
      for (const mesh of facing) mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      disposables.forEach((d) => d.dispose());
    },
  };
}
