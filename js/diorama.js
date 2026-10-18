// The 3D diorama block.
import * as THREE from 'three';
import { WATER, makeLetteringTexture } from './textures.js';

export const BLOCK = 100;

const rgb = (a) => new THREE.Vector3(a[0] / 255, a[1] / 255, a[2] / 255);

// ---------- topographic layers ----------

// Colour ramps.
export const RAMPS = {
  spectral: ['#3d4fa8', '#3e9fb6', '#8fd19e', '#f4ef9c', '#f6a35e', '#d6404e'],
  viridis: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'],
  magma: ['#000004', '#51127c', '#b73779', '#fc8961', '#fcfdbf'],
  sunset: ['#2b1a4b', '#7a2e6b', '#d0475c', '#f68a4e', '#fbd36a'],
  glacier: ['#0b2545', '#13315c', '#3e7cb1', '#8db8de', '#e8f1f8'],
};
const TERRAIN_RAMP = ['#4f7a43', '#7d9a52', '#b7b26c', '#c9a46b', '#9c7556', '#8a7d74', '#f2efe9'];

function rampColor(stops, t) {
  const x = Math.min(0.9999, Math.max(0, t)) * (stops.length - 1);
  const i = Math.floor(x);
  return new THREE.Color(stops[i]).lerp(new THREE.Color(stops[i + 1]), x - i);
}

function boxBlur(src, w, h, passes) {
  let a = src;
  for (let p = 0; p < passes; p++) {
    const out = new Float32Array(a.length);
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
            s += a[yy * w + xx];
            c++;
          }
        }
        out[y * w + x] = s / c;
      }
    }
    a = out;
  }
  return a;
}

// Terraced elevation grid.
function terraceGrid(d, topo) {
  const { w, h } = d.grid;
  const top = new Float32Array(w * h);
  const water = new Uint8Array(w * h);
  for (let i = 0; i < top.length; i++) {
    water[i] = d.mask[i] >= 0.5 ? 1 : 0;
    top[i] = water[i] && topo.water !== 'depth' ? Math.max(d.surf[i], d.grid.data[i]) : d.grid.data[i];
  }
  const sm = boxBlur(top, w, h, topo.smooth);
  let min = Infinity;
  let max = -Infinity;
  for (const v of sm) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const interval = Math.max(1e-6, (max - min) / topo.layers);
  const ceiling = topo.layers - 1e-4;
  const level = new Float32Array(sm.length);
  const out = new Float32Array(sm.length);
  for (let i = 0; i < sm.length; i++) {
    level[i] = Math.min(ceiling, (sm[i] - min) / interval);
    out[i] = min + Math.floor(level[i]) * interval;
  }
  let landLo = Infinity;
  let waterLo = Infinity;
  let waterHi = -Infinity;
  for (let i = 0; i < level.length; i++) {
    const l = Math.floor(level[i]);
    if (water[i]) {
      waterLo = Math.min(waterLo, l);
      waterHi = Math.max(waterHi, l);
    } else landLo = Math.min(landLo, l);
  }
  return {
    data: out,
    level,
    water,
    min,
    max: min + (topo.layers - 1) * interval,
    interval,
    landLo: Number.isFinite(landLo) ? landLo : 0,
    waterLo: Number.isFinite(waterLo) ? waterLo : 0,
    waterHi: Number.isFinite(waterHi) ? waterHi : 0,
  };
}

// Terraced surface geometry.
function terraceGeometry(nx, ny, level, water, place, yOfLevel, colorOf, W, D) {
  const pos = [];
  const col = [];
  const uvs = [];
  const put = (p, l, c) => {
    pos.push(p[0], yOfLevel(l), p[1]);
    col.push(c.r, c.g, c.b);
    uvs.push((p[0] + W / 2) / W, 1 - (p[1] + D / 2) / D);
  };
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const tri = (verts) => {
    const hs = verts.map((v) => v.h);
    const lo = Math.floor(Math.min(...hs));
    const hi = Math.floor(Math.max(...hs));
    const wet = verts.filter((v) => v.w).length >= 2;
    for (let c = lo; c <= hi; c++) {
      const above = verts.filter((v) => v.h >= c);
      const below = verts.filter((v) => v.h < c);
      const cc = colorOf(c, wet);
      if (above.length === 3) {
        for (const v of verts) put(v.p, c, cc);
        continue;
      }
      const cw = colorOf(c - 1, wet);
      const cross = (a, b) => lerp(a.p, b.p, (a.h - c) / (a.h - b.h));
      let n1;
      let n2;
      if (above.length === 2) {
        const [A, B] = above;
        const [C] = below;
        n1 = cross(A, C);
        n2 = cross(B, C);
        put(A.p, c, cc), put(B.p, c, cc), put(n2, c, cc);
        put(A.p, c, cc), put(n2, c, cc), put(n1, c, cc);
      } else {
        const [A] = above;
        const [B, C] = below;
        n1 = cross(A, B);
        n2 = cross(A, C);
        put(A.p, c, cc), put(n1, c, cc), put(n2, c, cc);
      }
      put(n1, c, cw), put(n2, c, cw), put(n2, c - 1, cw);
      put(n1, c, cw), put(n2, c - 1, cw), put(n1, c - 1, cw);
    }
  };
  const vtx = (i, j) => ({ p: place(i, j), h: level[j * nx + i], w: water[j * nx + i] });
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = vtx(i, j);
      const b = vtx(i, j + 1);
      const c = vtx(i + 1, j);
      const d = vtx(i + 1, j + 1);
      tri([a, b, c]);
      tri([c, b, d]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return g;
}

// Terraced wall profile.
function terraceProfile(samples) {
  const out = [];
  for (let k = 0; k < samples.length; k++) {
    const a = samples[k];
    out.push({ x: a.x, z: a.z, l: Math.floor(a.h) });
    const b = samples[k + 1];
    if (!b) break;
    const la = Math.floor(a.h);
    const lb = Math.floor(b.h);
    const step = lb > la ? 1 : -1;
    for (let c = la; c !== lb; c += step) {
      const edge = step > 0 ? c + 1 : c;
      const t = (edge - a.h) / (b.h - a.h);
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      out.push({ x, z, l: c }, { x, z, l: c + step });
    }
  }
  return out;
}

function canvasTexture(canvas, { srgb = true, repeat = false, anisotropy = 8 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = anisotropy;
  return t;
}

// Block edges.
function edges(nx, ny) {
  const lx = nx - 1;
  const ly = ny - 1;
  return {
    n: { normal: [0, 0, -1], count: nx, at: (k) => [lx - k, 0] },
    e: { normal: [1, 0, 0], count: ny, at: (k) => [lx, ly - k] },
    s: { normal: [0, 0, 1], count: nx, at: (k) => [k, ly] },
    w: { normal: [-1, 0, 0], count: ny, at: (k) => [0, k] },
  };
}

function stripGeometry(n, sample, normal, uvFn) {
  const pos = new Float32Array(n * 2 * 3);
  const nor = new Float32Array(n * 2 * 3);
  const uv = new Float32Array(n * 2 * 2);
  for (let k = 0; k < n; k++) {
    const { x, z, top, bottom } = sample(k);
    pos.set([x, top, z, x, bottom, z], k * 6);
    nor.set([...normal, ...normal], k * 6);
    const [u, vt, vb] = uvFn(k, top, bottom);
    uv.set([u, vt, u, vb], k * 4);
  }
  const idx = [];
  for (let k = 0; k < n - 1; k++) {
    const a = k * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

const waterSurfaceShader = {
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    varying vec3 vWorld;
    void main() {
      vUv = uv;
      vec4 w = modelMatrix * vec4(position, 1.0);
      vWorld = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D uCaustic;
    uniform sampler2D uMask;
    uniform vec3 uShallow;
    uniform vec3 uLightDir;
    uniform float uOpacity;
    uniform float uRepeat;
    uniform float uRipple;
    varying vec2 vUv;
    varying vec3 vWorld;
    void main() {
      float c1 = texture2D(uCaustic, vUv * uRepeat).a;
      float c2 = texture2D(uCaustic, vUv * uRepeat * 0.61 + vec2(0.37, 0.11)).a;
      float c = max(c1, c2 * 0.7) * uRipple;
      vec3 V = normalize(cameraPosition - vWorld);
      float fres = pow(1.0 - clamp(V.y, 0.0, 1.0), 4.0);
      vec3 H = normalize(V + normalize(uLightDir));
      float spec = pow(max(H.y, 0.0), 80.0);
      float glow = 1.0 - smoothstep(0.0, 0.75, distance(vUv, vec2(0.5)));
      vec3 col = mix(uShallow, vec3(1.0), 0.18 * glow) + c * 0.3 + spec * 0.5;
      float a = uOpacity * (0.22 + 0.3 * glow) + c * 0.16 + fres * 0.25 + spec * 0.4;
      float m = smoothstep(0.3, 0.7, texture2D(uMask, vec2(vUv.x, 1.0 - vUv.y)).r);
      if (m < 0.01) discard;
      gl_FragColor = vec4(col, clamp(a, 0.0, 0.92) * m);
    }`,
};

const waterWallShader = {
  vertexShader: /* glsl */ `
    attribute float aDepth;
    varying float vDepth;
    void main() {
      vDepth = aDepth;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uShallow;
    uniform vec3 uDeep;
    uniform float uDepthRef;
    uniform float uOpacity;
    varying float vDepth;
    void main() {
      float t = clamp(vDepth / uDepthRef, 0.0, 1.0);
      vec3 col = mix(uShallow, uDeep, pow(t, 0.7));
      float rim = (1.0 - smoothstep(0.0, uDepthRef * 0.03, vDepth)) * 0.6;
      col += rim * 0.35;
      float a = uOpacity * mix(0.5, 0.9, t) + rim * 0.2;
      gl_FragColor = vec4(col, a);
    }`,
};

// Build the diorama block.
export function buildDiorama(d, o, t) {
  const group = new THREE.Group();
  const disposables = [];
  const track = (x) => (disposables.push(x), x);

  const { grid } = d;
  const nx = grid.w;
  const ny = grid.h;
  const aspect = d.widthMeters / d.heightMeters;
  const W = aspect >= 1 ? BLOCK : BLOCK * aspect;
  const D = aspect >= 1 ? BLOCK / aspect : BLOCK;
  const vs = (W / d.widthMeters) * o.exaggeration;
  const terr = o.topo ? terraceGrid(d, o.topo) : null;
  const elev = terr ? terr.data : grid.data;
  let ref = Infinity;
  let maxE = -Infinity;
  for (let i = 0; i < nx * ny; i++) {
    ref = Math.min(ref, elev[i]);
    maxE = Math.max(maxE, !terr && d.mask[i] >= 0.5 ? d.surf[i] : elev[i]);
  }
  const yOf = (e) => (e - ref) * vs;
  const xOf = (i) => -W / 2 + (i / (nx - 1)) * W;
  const zOf = (j) => -D / 2 + (j / (ny - 1)) * D;
  const bed = (i, j) => elev[j * nx + i];
  const surf = (i, j) => d.surf[j * nx + i];
  const isWater = (i, j) => !terr && d.mask[j * nx + i] >= 0.5;
  const hasWater = !terr && d.mask.some((m) => m >= 0.5);

  const maxY = yOf(maxE);
  const baseY = -W * o.baseDepth;

  // ---- terrain surface ----
  const pos = new Float32Array(nx * ny * 3);
  const uv = new Float32Array(nx * ny * 2);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      pos.set([xOf(i), yOf(bed(i, j)), zOf(j)], k * 3);
      uv.set([i / (nx - 1), 1 - j / (ny - 1)], k * 2);
    }
  }
  const idx = new Uint32Array((nx - 1) * (ny - 1) * 6);
  let p = 0;
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      idx.set([a, a + nx, a + 1, a + 1, a + nx, a + nx + 1], p);
      p += 6;
    }
  }
  const tg = track(new THREE.BufferGeometry());
  tg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  tg.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  tg.setIndex(new THREE.BufferAttribute(idx, 1));
  tg.computeVertexNormals();
  const surfaceTex = track(canvasTexture(t.surface, { anisotropy: 16 }));
  let terrainMat;
  let wallColor = null;
  if (terr) {
    const mode = o.topo.color;
    const stops = mode === 'terrain' ? TERRAIN_RAMP : o.topo.ramp === 'custom' ? [o.topo.low, o.topo.high] : RAMPS[o.topo.ramp] || RAMPS.spectral;
    const mat = { roughness: 0.92, metalness: 0, flatShading: true, side: THREE.DoubleSide };
    const colourWater = o.topo.water !== 'land';
    if (mode === 'imagery') mat.map = surfaceTex;
    mat.vertexColors = true;
    terrainMat = new THREE.MeshStandardMaterial(mat);
    const mono = new THREE.Color(o.topo.mono);
    const white = new THREE.Color(1, 1, 1);
    const top = Math.max(1, o.topo.layers - 1);
    const landColor = (l) => {
      if (mode === 'imagery') return white;
      if (mode === 'mono') return mono;
      return rampColor(stops, (Math.max(terr.landLo, l) - terr.landLo) / Math.max(1, top - terr.landLo));
    };
    const wc = new THREE.Color(o.topo.waterColor);
    const shallow = wc.clone().lerp(white, 0.35);
    const deep = wc.clone().multiplyScalar(0.45);
    const waterColor = (l) => {
      if (o.topo.water !== 'depth') return wc;
      const span = Math.max(1, terr.waterHi - terr.waterLo);
      return deep.clone().lerp(shallow, Math.min(1, Math.max(0, (l - terr.waterLo) / span)));
    };
    o.topo.colorOf = (l, wet) => (wet && colourWater ? waterColor(l) : landColor(l));
    wallColor = o.wallTint ? new THREE.Color(o.wallTint) : mode === 'mono' ? mono : mode === 'imagery' ? new THREE.Color('#d9d4cc') : rampColor(stops, 0);
  } else terrainMat = new THREE.MeshStandardMaterial({ map: surfaceTex, roughness: 0.95, metalness: 0 });
  let terrainGeo = tg;
  if (terr) {
    const colorOf = o.topo.colorOf;
    terrainGeo = track(terraceGeometry(nx, ny, terr.level, terr.water, (i, j) => [xOf(i), zOf(j)], (l) => yOf(terr.min + l * terr.interval), colorOf, W, D));
  }
  const terrainMesh = new THREE.Mesh(terrainGeo, track(terrainMat));
  terrainMesh.castShadow = terrainMesh.receiveShadow = !!o.shadows;
  group.add(terrainMesh);

  // ---- walls ----
  const rockTex = track(canvasTexture(t.rock, { repeat: true }));
  const wallH = Math.max(maxY, 1) - baseY;
  const rockMat = track(
    wallColor
      ? new THREE.MeshStandardMaterial({ color: wallColor.clone().multiplyScalar(0.92), roughness: 0.95, metalness: 0, side: THREE.DoubleSide })
      : new THREE.MeshStandardMaterial({ map: rockTex, roughness: 1, metalness: 0, side: THREE.DoubleSide }),
  );
  const waterWallMat = track(
    new THREE.ShaderMaterial({
      ...waterWallShader,
      uniforms: {
        uShallow: { value: rgb(WATER.shallow) },
        uDeep: { value: rgb(WATER.deep) },
        uDepthRef: { value: d.depthRef || 1 },
        uOpacity: { value: o.waterOpacity },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );

  const glassPts = [];
  for (const [key, edge] of Object.entries(edges(nx, ny))) {
    const n = edge.count;
    const edgeLen = edge.normal[0] ? D : W;
    const repeatU = edgeLen / (wallH * 4.0);
    let rockGeo;
    if (terr) {
      const prof = terraceProfile(
        Array.from({ length: n }, (_, k) => {
          const [i, j] = edge.at(k);
          return { x: xOf(i), z: zOf(j), h: terr.level[j * nx + i] };
        }),
      );
      rockGeo = track(
        stripGeometry(
          prof.length,
          (k) => ({ x: prof[k].x, z: prof[k].z, top: yOf(terr.min + prof[k].l * terr.interval), bottom: baseY }),
          edge.normal,
          () => [0, 1, 0],
        ),
      );
    } else {
      rockGeo = track(
        stripGeometry(
          n,
          (k) => {
            const [i, j] = edge.at(k);
            return { x: xOf(i), z: zOf(j), top: yOf(bed(i, j)), bottom: baseY };
          },
          edge.normal,
          (k, top, bottom) => [(k / (n - 1)) * repeatU, 1, 1 - (top - bottom) / wallH],
        ),
      );
    }
    const wall = new THREE.Mesh(rockGeo, rockMat);
    wall.castShadow = wall.receiveShadow = !!o.shadows;
    group.add(wall);

    if (hasWater) {
      const wg = track(
        stripGeometry(
          n,
          (k) => {
            const [i, j] = edge.at(k);
            const b = yOf(bed(i, j));
            return { x: xOf(i), z: zOf(j), top: isWater(i, j) ? yOf(surf(i, j)) : b, bottom: b };
          },
          edge.normal,
          () => [0, 0, 0],
        ),
      );
      const aDepth = new Float32Array(n * 2);
      for (let k = 0; k < n; k++) {
        const [i, j] = edge.at(k);
        aDepth[k * 2 + 1] = isWater(i, j) ? surf(i, j) - bed(i, j) : 0;
      }
      wg.setAttribute('aDepth', new THREE.BufferAttribute(aDepth, 1));
      const wm = new THREE.Mesh(wg, waterWallMat);
      wm.renderOrder = 1;
      group.add(wm);
      for (let k = 0; k < n - 1; k++) {
        const [i0, j0] = edge.at(k);
        const [i1, j1] = edge.at(k + 1);
        if (isWater(i0, j0) && isWater(i1, j1)) {
          glassPts.push(xOf(i0), yOf(surf(i0, j0)) + 0.02, zOf(j0), xOf(i1), yOf(surf(i1, j1)) + 0.02, zOf(j1));
        }
      }
    }

    const label = (o.labels?.[key] || '').trim();
    if (label) {
      const band = W * o.baseDepth;
      const width = Math.min(edgeLen * 0.9, band * 0.55 * 16);
      const tex = track(canvasTexture(makeLetteringTexture(label)));
      const plane = new THREE.Mesh(
        track(new THREE.PlaneGeometry(width, width / 16)),
        track(new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })),
      );
      const [nrmX, , nrmZ] = edge.normal;
      plane.position.set(nrmX * (W / 2 + 0.05), baseY + band * 0.5, nrmZ * (D / 2 + 0.05));
      plane.rotation.y = Math.atan2(nrmX, nrmZ);
      plane.renderOrder = 3;
      group.add(plane);
    }
  }

  // ---- water surface ----
  let waterSurface = null;
  if (hasWater) {
    const causticTex = track(canvasTexture(t.caustic, { srgb: false }));
    causticTex.wrapS = causticTex.wrapT = THREE.RepeatWrapping;
    const maskTex = track(new THREE.DataTexture(d.maskHi.data, d.maskHi.w, d.maskHi.h, THREE.RedFormat, THREE.UnsignedByteType));
    maskTex.magFilter = maskTex.minFilter = THREE.LinearFilter;
    maskTex.unpackAlignment = 1;
    maskTex.needsUpdate = true;
    const wmat = track(
      new THREE.ShaderMaterial({
        ...waterSurfaceShader,
        uniforms: {
          uCaustic: { value: causticTex },
          uMask: { value: maskTex },
          uShallow: { value: rgb(WATER.shallow) },
          uLightDir: { value: new THREE.Vector3(-0.5, 0.8, -0.3) },
          uOpacity: { value: o.waterOpacity },
          uRepeat: { value: 14 },
          uRipple: { value: o.ripple },
        },
        transparent: true,
        depthWrite: false,
      }),
    );
    const wpos = new Float32Array(nx * ny * 3);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const y = isWater(i, j) ? yOf(surf(i, j)) + 0.03 : yOf(bed(i, j)) - 0.15;
        wpos.set([xOf(i), y, zOf(j)], (j * nx + i) * 3);
      }
    }
    const wg = track(new THREE.BufferGeometry());
    wg.setAttribute('position', new THREE.BufferAttribute(wpos, 3));
    wg.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    wg.setIndex(new THREE.BufferAttribute(idx, 1));
    waterSurface = new THREE.Mesh(wg, wmat);
    waterSurface.renderOrder = 2;
    group.add(waterSurface);

    for (const [i, j] of [[0, 0], [nx - 1, 0], [0, ny - 1], [nx - 1, ny - 1]]) {
      if (isWater(i, j)) glassPts.push(xOf(i), yOf(bed(i, j)), zOf(j), xOf(i), yOf(surf(i, j)) + 0.02, zOf(j));
    }
  }
  if (glassPts.length) {
    const gg = track(new THREE.BufferGeometry());
    gg.setAttribute('position', new THREE.Float32BufferAttribute(glassPts, 3));
    const glass = new THREE.LineSegments(
      gg,
      track(new THREE.LineBasicMaterial({ color: 0xdffaff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })),
    );
    glass.renderOrder = 4;
    group.add(glass);
  }

  // ---- drop shadow ----
  const shadowTex = track(canvasTexture(t.shadow, { srgb: false }));
  const shadow = new THREE.Mesh(
    track(new THREE.PlaneGeometry(W * 1.6, D * 1.6)),
    track(new THREE.MeshBasicMaterial({ map: shadowTex, color: 0x000000, transparent: true, depthWrite: false })),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(BLOCK * 0.035, baseY - 0.05, BLOCK * 0.035);
  shadow.renderOrder = -1;
  group.add(shadow);

  if (o.shadows && o.floorShadow) {
    const floor = new THREE.Mesh(track(new THREE.PlaneGeometry(BLOCK * 6, BLOCK * 6)), track(new THREE.ShadowMaterial({ opacity: 0.32 })));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = baseY - 0.04;
    floor.receiveShadow = true;
    group.add(floor);
  }

  const topAt = (u, v) => {
    const fx = Math.min(nx - 1, Math.max(0, u * (nx - 1)));
    const fy = Math.min(ny - 1, Math.max(0, v * (ny - 1)));
    const i0 = Math.floor(fx);
    const j0 = Math.floor(fy);
    const i1 = Math.min(nx - 1, i0 + 1);
    const j1 = Math.min(ny - 1, j0 + 1);
    const at = (i, j) => (isWater(i, j) ? Math.max(surf(i, j), bed(i, j)) : bed(i, j));
    const tx = fx - i0;
    const ty = fy - j0;
    const e = (at(i0, j0) * (1 - tx) + at(i1, j0) * tx) * (1 - ty) + (at(i0, j1) * (1 - tx) + at(i1, j1) * tx) * ty;
    return yOf(e);
  };
  const waterAt = (u, v) => isWater(Math.round(Math.min(1, Math.max(0, u)) * (nx - 1)), Math.round(Math.min(1, Math.max(0, v)) * (ny - 1)));

  return {
    group,
    baseY,
    topY: Math.max(maxY, 0),
    waterSurface,
    surfaceTexture: surfaceTex,
    topAt,
    waterAt,
    width: W,
    depth: D,
    terrace: terr ? { interval: terr.interval, layers: o.topo.layers } : null,
    metersPerUnit: d.widthMeters / W,
    toLocal: (u, v) => ({ x: -W / 2 + u * W, z: -D / 2 + v * D }),
    toUV: (x, z) => [(x + W / 2) / W, (z + D / 2) / D],
    dispose() {
      disposables.forEach((x) => x.dispose());
    },
  };
}
