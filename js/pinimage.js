// Custom pin heads from images.
import * as THREE from 'three';

const TEX_MAX = 512;

// Load an image.
export async function loadPinImage(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, TEX_MAX / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k));
  const h = Math.max(1, Math.round(bmp.height * k));
  const src = document.createElement('canvas');
  src.width = w;
  src.height = h;
  const sc = src.getContext('2d');
  sc.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const px = sc.getImageData(0, 0, w, h).data;

  let r = 0, g = 0, b = 0, n = 0;
  const alpha = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) {
    alpha[i] = px[i * 4 + 3];
    if (alpha[i] >= 128) (r += px[i * 4]), (g += px[i * 4 + 1]), (b += px[i * 4 + 2]), n++;
  }
  if (!n) throw new Error('the image has no opaque pixels to trace');
  const avg = new THREE.Color(`rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`);

  const tc = document.createElement('canvas');
  tc.width = w;
  tc.height = h;
  const tx = tc.getContext('2d');
  tx.fillStyle = `#${avg.getHexString()}`;
  tx.fillRect(0, 0, w, h);
  tx.drawImage(src, 0, 0);
  const texture = new THREE.CanvasTexture(tc);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  return { name: file.name, texture, avg, src, aspect: w / h, cache: new Map() };
}

// ---------- silhouette tracing ----------

// Alpha mask.
function maskAt(img, size) {
  const k = size / Math.max(img.src.width, img.src.height);
  const w = Math.max(2, Math.round(img.src.width * k));
  const h = Math.max(2, Math.round(img.src.height * k));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const cx = c.getContext('2d');
  cx.imageSmoothingQuality = 'high';
  cx.drawImage(img.src, 0, 0, w, h);
  const d = cx.getImageData(0, 0, w, h).data;
  const m = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) m[i] = d[i * 4 + 3] >= 128 ? 1 : 0;
  return { w, h, m };
}

// Trace outlines.
function traceLoops({ w, h, m }) {
  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h && m[y * w + x] === 1;
  const W = w + 1;
  const out = new Map();
  const add = (x0, y0, x1, y1) => {
    const id = y0 * W + x0;
    if (!out.has(id)) out.set(id, []);
    out.get(id).push({ x0, y0, x1, y1, dx: x1 - x0, dy: y1 - y0, used: false });
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      if (!inside(x, y - 1)) add(x, y, x + 1, y);
      if (!inside(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!inside(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!inside(x - 1, y)) add(x, y + 1, x, y);
    }
  const loops = [];
  for (const list of out.values())
    for (const start of list) {
      if (start.used) continue;
      const pts = [];
      let e = start;
      while (e && !e.used) {
        e.used = true;
        pts.push([e.x0, e.y0]);
        const next = (out.get(e.y1 * W + e.x1) || []).filter((c) => !c.used);
        if (next.length > 1) {
          const rx = -e.dy, ry = e.dx;
          next.sort((a, b) => (b.dx === rx && b.dy === ry) - (a.dx === rx && a.dy === ry));
        }
        e = next[0];
      }
      if (pts.length >= 4) loops.push(pts);
    }
  return loops;
}

const area = (p) => {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i];
    const [x1, y1] = p[(i + 1) % p.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
};

function inPoly([x, y], p) {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i];
    const [xj, yj] = p[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

// Douglas–Peucker.
function dp(pts, eps) {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0];
  const [bx, by] = pts[pts.length - 1];
  const len = Math.hypot(bx - ax, by - ay) || 1;
  let best = -1, bi = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / len;
    if (d > best) (best = d), (bi = i);
  }
  if (best <= eps) return [pts[0], pts[pts.length - 1]];
  return [...dp(pts.slice(0, bi + 1), eps).slice(0, -1), ...dp(pts.slice(bi), eps)];
}

// Simplify a closed loop.
function simplifyLoop(p, eps) {
  let far = 0, fd = -1;
  for (let i = 1; i < p.length; i++) {
    const d = (p[i][0] - p[0][0]) ** 2 + (p[i][1] - p[0][1]) ** 2;
    if (d > fd) (fd = d), (far = i);
  }
  const a = dp(p.slice(0, far + 1), eps);
  const b = dp([...p.slice(far), p[0]], eps);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

// Chaikin smoothing.
function chaikin(p) {
  const out = [];
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i];
    const [x1, y1] = p[(i + 1) % p.length];
    out.push([0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1], [0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1]);
  }
  return out;
}

// Extruded head geometry.
export function imageHeadGeometry(img, detail = 1, depth = 0.15) {
  const key = `${detail}|${depth}`;
  if (img.cache.has(key)) return img.cache.get(key);
  const size = Math.round(detail >= 1 ? 160 : detail >= 0.6 ? 110 : 72);
  const mask = maskAt(img, size);
  const minArea = Math.max(3, (size * size) / 2500);
  const loops = traceLoops(mask)
    .map((l) => ({ pts: l, a: area(l) }))
    .filter((l) => Math.abs(l.a) >= minArea)
    .map((l) => {
      let pts = simplifyLoop(l.pts, detail >= 1 ? 0.6 : 0.9);
      if (detail >= 0.6 && pts.length >= 4) pts = chaikin(pts);
      return { ...l, pts };
    })
    .filter((l) => l.pts.length >= 3);
  const outers = loops.filter((l) => l.a > 0).sort((a, b) => a.a - b.a);
  if (!outers.length) throw new Error('could not trace a shape from the image');

  const toUV = ([x, y]) => new THREE.Vector2(x / mask.w, 1 - y / mask.h);
  const shapes = new Map(outers.map((o) => [o, new THREE.Shape(o.pts.map(toUV))]));
  for (const hole of loops.filter((l) => l.a < 0)) {
    const host = outers.find((o) => inPoly(hole.pts[0], o.pts));
    if (host) shapes.get(host).holes.push(new THREE.Path(hole.pts.map(toUV)));
  }

  const S = 0.8;
  const sx = (S * mask.w) / Math.max(mask.w, mask.h);
  const sy = (S * mask.h) / Math.max(mask.w, mask.h);
  const d = Math.max(0.01, depth * S);
  const geo = new THREE.ExtrudeGeometry([...shapes.values()], { depth: d, bevelEnabled: false, curveSegments: 1 });
  geo.scale(sx, sy, 1);
  geo.translate(-sx / 2, 0, -d / 2);
  const part = (mat) => {
    const grps = geo.groups.filter((gr) => gr.materialIndex === mat);
    const g = new THREE.BufferGeometry();
    for (const k of ['position', 'normal', 'uv']) {
      const a = geo.attributes[k];
      const arr = new Float32Array(grps.reduce((s, gr) => s + gr.count, 0) * a.itemSize);
      let o = 0;
      for (const gr of grps) {
        const chunk = a.array.subarray(gr.start * a.itemSize, (gr.start + gr.count) * a.itemSize);
        arr.set(chunk, o);
        o += chunk.length;
      }
      g.setAttribute(k, new THREE.BufferAttribute(arr, a.itemSize));
    }
    return g;
  };
  const res = { caps: part(0), sides: part(1), height: sy };
  geo.dispose();
  img.cache.set(key, res);
  return res;
}
