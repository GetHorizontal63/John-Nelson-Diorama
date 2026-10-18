// Compass rose lying flat on the diorama, pointing true north.
import * as THREE from 'three';

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Compass rose texture.
export function drawCompassRose(color, px = 1024) {
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const ctx = c.getContext('2d');
  const [r, g, b] = hexToRgb(color);
  const solid = `rgb(${r},${g},${b})`;
  const tint = `rgba(${r},${g},${b},0.35)`;
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const halo = lum > 0.5 ? 'rgba(0,0,0,0.65)' : 'rgba(255,255,255,0.75)';
  const cx = px / 2;
  const R = px * 0.32;
  ctx.translate(cx, cx);
  ctx.shadowColor = halo;
  ctx.shadowBlur = px * 0.012;
  ctx.lineJoin = 'round';

  // Rings and spokes
  ctx.strokeStyle = solid;
  ctx.lineWidth = px * 0.004;
  for (const rr of [R * 0.93, R * 1.0]) {
    ctx.beginPath();
    ctx.arc(0, 0, rr, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.lineWidth = px * 0.0022;
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.sin(a) * R * 0.2, -Math.cos(a) * R * 0.2);
    ctx.lineTo(Math.sin(a) * R * 0.93, -Math.cos(a) * R * 0.93);
    ctx.stroke();
  }

  // Star points
  const point = (deg, len, half) => {
    const a = (deg * Math.PI) / 180;
    const tip = [Math.sin(a) * len, -Math.cos(a) * len];
    const side = (s) => [Math.sin(a + s * half) * R * 0.2, -Math.cos(a + s * half) * R * 0.2];
    const left = side(-1);
    const right = side(1);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(...tip);
    ctx.lineTo(...left);
    ctx.closePath();
    ctx.fillStyle = solid;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(...tip);
    ctx.lineTo(...right);
    ctx.closePath();
    ctx.fillStyle = tint;
    ctx.fill();
    ctx.lineWidth = px * 0.003;
    ctx.strokeStyle = solid;
    ctx.beginPath();
    ctx.moveTo(...left);
    ctx.lineTo(...tip);
    ctx.lineTo(...right);
    ctx.stroke();
  };
  for (const d of [45, 135, 225, 315]) point(d, R * 0.68, Math.PI / 5);
  for (const d of [0, 90, 180, 270]) point(d, R * 1.12, Math.PI / 5);
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.06, 0, Math.PI * 2);
  ctx.fillStyle = solid;
  ctx.fill();

  // Letters
  ctx.fillStyle = solid;
  ctx.font = `700 ${px * 0.09}px "Raleway", "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(([t, deg]) => {
    ctx.save();
    ctx.rotate((deg * Math.PI) / 180);
    ctx.fillText(t, 0, -R * 1.32);
    ctx.restore();
  });
  return c;
}

// Compass rose mesh.
export function buildCompass(built, camera, opts) {
  const group = new THREE.Group();
  const tex = new THREE.CanvasTexture(drawCompassRose(opts.color));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const D = Math.max(built.width, built.depth) * opts.size;
  const geo = new THREE.PlaneGeometry(D, D);
  geo.rotateX(-Math.PI / 2);
  const ground = opts.position === 'ground';
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: opts.opacity, depthWrite: false, depthTest: ground });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = ground ? 2 : 14;

  const hw = built.width / 2;
  const hd = built.depth / 2;
  const inset = D * 0.55 + 1;
  const corners = {
    nw: [-hw + inset, -hd + inset],
    ne: [hw - inset, -hd + inset],
    se: [hw - inset, hd - inset],
    sw: [-hw + inset, hd - inset],
  };
  const look = new THREE.Vector3();
  camera.getWorldDirection(look);
  const right = [-look.z, look.x];
  let x;
  let z;
  let y;
  if (ground) {
    const n = Math.abs(look.x) > Math.abs(look.z) ? [-Math.sign(look.x), 0] : [0, -Math.sign(look.z)];
    const half = n[0] ? hw : hd;
    const along = (n[0] ? hd : hw) * 0.55;
    x = n[0] * (half + D * 0.65) + right[0] * along;
    z = n[1] * (half + D * 0.65) + right[1] * along;
    y = built.baseY + 0.02;
  } else {
    const key = opts.position === 'auto' || !corners[opts.position]
      ? Object.keys(corners).reduce((best, k) => {
          const s = (p) => p[0] * look.x + p[1] * look.z - (p[0] * right[0] + p[1] * right[1]);
          return s(corners[k]) > s(corners[best]) ? k : best;
        }, 'nw')
      : opts.position;
    [x, z] = corners[key];
    let top = -Infinity;
    for (let i = -2; i <= 2; i++) {
      for (let j = -2; j <= 2; j++) top = Math.max(top, built.topAt(...built.toUV(x + (i * D) / 5, z + (j * D) / 5)));
    }
    y = top + 0.4;
  }
  mesh.position.set(x, y, z);
  mesh.rotation.y = opts.north || 0;
  group.add(mesh);
  const r = D * 0.45;
  return {
    group,
    footprint: [[x - r, y, z - r], [x + r, y, z - r], [x + r, y, z + r], [x - r, y, z + r]],
    dispose() {
      geo.dispose();
      mat.dispose();
      tex.dispose();
    },
  };
}
