// 2D layers around the block: locators, title, credits and scale.

// Theme.
let INK = '255,255,255';
let BG = ['#3b3a3d', '#161618'];
export function setOverlayTheme(theme) {
  INK = theme === 'light' ? '34,34,38' : '255,255,255';
  BG = theme === 'light' ? ['#f4f3f1', '#d8d7d4'] : ['#3b3a3d', '#161618'];
}

// Corner locator.
export function prepareLocator(mosaic, regionBbox, selBbox) {
  const c = mosaic.canvas;
  const sx = c.width / (regionBbox.x1 - regionBbox.x0);
  const sy = c.height / (regionBbox.y1 - regionBbox.y0);
  const corners = selBbox.corners || [
    { x: selBbox.x0, y: selBbox.y0 },
    { x: selBbox.x1, y: selBbox.y0 },
    { x: selBbox.x1, y: selBbox.y1 },
    { x: selBbox.x0, y: selBbox.y1 },
  ];
  return { image: c, pts: corners.map((p) => [(p.x - regionBbox.x0) * sx, (p.y - regionBbox.y0) * sy]) };
}

export function drawLocator(ctx, W, H, loc, viewAzimuthDeg, showArrow = true, side = 'left') {
  if (!loc) return;
  const size = Math.round(H * 0.62);
  const off = document.createElement('canvas');
  off.width = off.height = size;
  const o = off.getContext('2d');
  const img = loc.image;
  const k = size / Math.max(img.width, img.height);
  o.filter = 'saturate(0.85) brightness(0.8)';
  o.drawImage(img, 0, 0, img.width * k, img.height * k);
  o.filter = 'none';

  const pts = loc.pts.map(([x, y]) => [x * k, y * k]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const bx = Math.min(...xs);
  const by = Math.min(...ys);
  const bw = Math.max(...xs) - bx;
  const bh = Math.max(...ys) - by;
  const outline = new Path2D();
  pts.forEach(([x, y], i) => (i ? outline.lineTo(x, y) : outline.moveTo(x, y)));
  outline.closePath();
  const lw = Math.max(1.5, size * 0.004);
  o.save();
  o.shadowColor = 'rgba(0,0,0,0.6)';
  o.shadowBlur = size * 0.02;
  const grad = o.createLinearGradient(bx, by, bx + bw, by + bh);
  grad.addColorStop(0, 'rgba(255,255,255,0.05)');
  grad.addColorStop(1, 'rgba(255,255,255,0.28)');
  o.fillStyle = grad;
  o.fill(outline);
  o.restore();
  o.strokeStyle = 'rgba(255,255,255,0.9)';
  o.lineWidth = lw;
  o.lineJoin = 'round';
  o.stroke(outline);

  if (showArrow) drawArrow(o, bx, by, bw, bh, lw, viewAzimuthDeg);

  o.globalCompositeOperation = 'destination-in';
  const fx = side === 'right' ? 0.58 : 0.42;
  const m = o.createRadialGradient(size * fx, size * 0.58, size * 0.12, size * fx, size * 0.58, size * 0.58);
  m.addColorStop(0, 'rgba(0,0,0,0.95)');
  m.addColorStop(0.6, 'rgba(0,0,0,0.6)');
  m.addColorStop(1, 'rgba(0,0,0,0)');
  o.fillStyle = m;
  o.fillRect(0, 0, size, size);

  ctx.drawImage(off, side === 'right' ? W - size * 0.96 : -size * 0.04, H - size * 0.96);
}

// ---------- full-side locator ----------

// Full-side locator.
export function prepareSideLocator(image, regionBbox, selFrame) {
  const sx = image.width / (regionBbox.x1 - regionBbox.x0);
  const sy = image.height / (regionBbox.y1 - regionBbox.y0);
  const px = (p) => [(p.x - regionBbox.x0) * sx, (p.y - regionBbox.y0) * sy];
  return { image, pts: selFrame.corners.map(px), centre: px({ x: selFrame.cx, y: selFrame.cy }) };
}

export function drawSideLocator(ctx, W, H, loc, viewAzimuthDeg, showArrow = true, side = 'right') {
  if (!loc) return;
  const pw = Math.round(W * 0.44);
  const off = document.createElement('canvas');
  off.width = pw;
  off.height = H;
  const o = off.getContext('2d');
  const img = loc.image;
  const k = Math.max(pw / img.width, H / img.height) * 1.0;
  let ox = pw * (side === 'right' ? 0.55 : 0.45) - loc.centre[0] * k;
  let oy = H * 0.42 - loc.centre[1] * k;
  ox = Math.min(0, Math.max(pw - img.width * k, ox));
  oy = Math.min(0, Math.max(H - img.height * k, oy));
  o.filter = 'saturate(0.9) brightness(0.92)';
  o.drawImage(img, ox, oy, img.width * k, img.height * k);
  o.filter = 'none';

  const pts = loc.pts.map(([x, y]) => [ox + x * k, oy + y * k]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const bx = Math.min(...xs);
  const by = Math.min(...ys);
  const bw = Math.max(...xs) - bx;
  const bh = Math.max(...ys) - by;
  const outline = new Path2D();
  pts.forEach(([x, y], i) => (i ? outline.lineTo(x, y) : outline.moveTo(x, y)));
  outline.closePath();
  const lw = Math.max(1.5, H * 0.0018);
  o.save();
  o.shadowColor = 'rgba(0,0,0,0.6)';
  o.shadowBlur = H * 0.012;
  const g = o.createLinearGradient(bx, by, bx + bw, by + bh);
  g.addColorStop(0, 'rgba(255,255,255,0.06)');
  g.addColorStop(1, 'rgba(255,255,255,0.3)');
  o.fillStyle = g;
  o.fill(outline);
  o.restore();
  o.strokeStyle = 'rgba(255,255,255,0.95)';
  o.lineWidth = lw;
  o.lineJoin = 'round';
  o.stroke(outline);
  if (showArrow) drawArrow(o, bx, by, bw, bh, lw, viewAzimuthDeg);

  o.globalCompositeOperation = 'destination-in';
  const hz = o.createLinearGradient(side === 'right' ? 0 : pw, 0, side === 'right' ? pw : 0, 0);
  hz.addColorStop(0, 'rgba(0,0,0,0)');
  hz.addColorStop(0.42, 'rgba(0,0,0,0.85)');
  hz.addColorStop(1, 'rgba(0,0,0,1)');
  o.fillStyle = hz;
  o.fillRect(0, 0, pw, H);
  const vt = o.createLinearGradient(0, 0, 0, H);
  vt.addColorStop(0, 'rgba(0,0,0,0.55)');
  vt.addColorStop(0.12, 'rgba(0,0,0,1)');
  vt.addColorStop(0.88, 'rgba(0,0,0,1)');
  vt.addColorStop(1, 'rgba(0,0,0,0.55)');
  o.fillStyle = vt;
  o.fillRect(0, 0, pw, H);
  ctx.drawImage(off, side === 'right' ? W - pw : 0, 0);
}

// ---------- globe locator ----------

const RAD = Math.PI / 180;

// Globe locator.
export function prepareGlobe(world, lng0, lat0, size = 640) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const src = world.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, world.width, world.height);
  const out = ctx.createImageData(size, size);
  const R = size * 0.46;
  const cx = size / 2;
  const cy = size / 2;
  const sp = Math.sin(lat0 * RAD);
  const cp = Math.cos(lat0 * RAD);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x - cx) / R;
      const ny = (cy - y) / R;
      const r2 = nx * nx + ny * ny;
      if (r2 > 1) continue;
      const z = Math.sqrt(1 - r2);
      const lat = Math.asin(Math.max(-1, Math.min(1, z * sp + ny * cp)));
      const lng = lng0 * RAD + Math.atan2(nx, z * cp - ny * sp);
      const u = ((((lng / RAD + 180) % 360) + 360) % 360) / 360;
      const s = Math.sin(Math.max(-85, Math.min(85, lat / RAD)) * RAD);
      const v = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
      const sx = Math.min(world.width - 1, Math.floor(u * world.width));
      const sy = Math.min(world.height - 1, Math.max(0, Math.floor(v * world.height)));
      const si = (sy * world.width + sx) * 4;
      const di = (y * size + x) * 4;
      const shade = 0.45 + 0.6 * Math.pow(z, 0.6);
      out.data[di] = src.data[si] * shade;
      out.data[di + 1] = src.data[si + 1] * shade;
      out.data[di + 2] = src.data[si + 2] * shade;
      out.data[di + 3] = 255 * Math.min(1, (1 - Math.sqrt(r2)) * R * 0.8);
    }
  }
  ctx.putImageData(out, 0, 0);
  // Atmosphere rim
  const g = ctx.createRadialGradient(cx, cy, R * 0.92, cx, cy, R * 1.08);
  g.addColorStop(0, 'rgba(120,190,255,0)');
  g.addColorStop(0.45, 'rgba(120,190,255,0.35)');
  g.addColorStop(1, 'rgba(120,190,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  const project = (lng, lat) => {
    const p = lat * RAD;
    const dl = (lng - lng0) * RAD;
    const cosc = sp * Math.sin(p) + cp * Math.cos(p) * Math.cos(dl);
    if (cosc < 0) return null;
    return [cx + R * Math.cos(p) * Math.sin(dl), cy - R * (cp * Math.sin(p) - sp * Math.cos(p) * Math.cos(dl))];
  };
  return { image: c, project, size, radius: R };
}

export function drawGlobe(ctx, W, H, globe, corners, viewAzimuthDeg, showArrow = true, side = 'left') {
  if (!globe) return;
  const size = Math.round(H * 0.34);
  const k = size / globe.size;
  const x0 = side === 'right' ? W - size - W * 0.025 : W * 0.025;
  const y0 = H - size - H * 0.04;
  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.drawImage(globe.image, x0, y0, size, size);
  ctx.globalAlpha = 1;
  const pts = corners.map(([lng, lat]) => globe.project(lng, lat)).filter(Boolean);
  if (pts.length === 4) {
    const P = pts.map(([x, y]) => [x0 + x * k, y0 + y * k]);
    const cx = P.reduce((s, p) => s + p[0], 0) / 4;
    const cy = P.reduce((s, p) => s + p[1], 0) / 4;
    const span = Math.max(...P.map((p) => Math.hypot(p[0] - cx, p[1] - cy)));
    const lw = Math.max(1.5, H * 0.0015);
    const ring = Math.max(span * 1.6, size * 0.035);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, ring * 2.2);
    g.addColorStop(0, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, ring * 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = lw;
    ctx.beginPath();
    if (span > 4) P.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    else ctx.arc(cx, cy, ring * 0.5, 0, Math.PI * 2);
    ctx.closePath();
    ctx.stroke();
    if (showArrow) {
      const r = Math.max(ring * 1.6, size * 0.08);
      drawArrow(ctx, cx - r, cy - r, r * 2, r * 2, lw, viewAzimuthDeg);
    }
  }
  ctx.restore();
}

function drawArrow(o, bx, by, bw, bh, lw, viewAzimuthDeg) {
  const a = (viewAzimuthDeg * Math.PI) / 180;
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  const cx = bx + bw / 2;
  const cy = by + bh / 2;
  const r = Math.min(bw, bh) * 0.38;
  const x0 = cx - dx * r;
  const y0 = cy - dy * r;
  const x1 = cx + dx * r;
  const y1 = cy + dy * r;
  o.strokeStyle = 'rgba(255,255,255,0.95)';
  o.fillStyle = 'rgba(255,255,255,0.95)';
  o.lineWidth = lw;
  o.beginPath();
  o.moveTo(x0, y0);
  o.lineTo(x1, y1);
  o.stroke();
  const head = Math.max(5, r * 0.35);
  o.beginPath();
  o.moveTo(x1, y1);
  o.lineTo(x1 - dx * head - dy * head * 0.5, y1 - dy * head + dx * head * 0.5);
  o.lineTo(x1 - dx * head + dy * head * 0.5, y1 - dy * head - dx * head * 0.5);
  o.closePath();
  o.fill();
}

export function drawBackground(ctx, W, H) {
  const g = ctx.createRadialGradient(W * 0.45, H * 0.55, 0, W * 0.45, H * 0.55, Math.hypot(W, H) * 0.6);
  g.addColorStop(0, BG[0]);
  g.addColorStop(1, BG[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

// Background word.
export function drawDescriptor(ctx, W, H, opts) {
  const chars = [...(opts?.text || '').toUpperCase()];
  if (!chars.length) return;
  const fs = H * (opts.size || 0.2);
  const y = { top: 0.2, middle: 0.5, bottom: 0.8 }[opts.position] ?? 0.5;
  ctx.save();
  ctx.font = `200 ${fs}px "Raleway", "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const g = ctx.createLinearGradient(0, H * y - fs / 2, 0, H * y + fs / 2);
  g.addColorStop(0, `rgba(${INK},${opts.opacity})`);
  g.addColorStop(1, `rgba(${INK},${opts.opacity * 0.25})`);
  ctx.fillStyle = g;
  const pad = W * 0.06;
  const step = chars.length > 1 ? (W - 2 * pad) / (chars.length - 1) : 0;
  chars.forEach((ch, i) => ctx.fillText(ch, chars.length > 1 ? pad + i * step : W / 2, H * y));
  ctx.restore();
}

// Title and credits.
export function drawTitle(ctx, W, H, title, credits, position = 'top', corner = 'br') {
  const chars = [...(title || '').toUpperCase()];
  if (chars.length) {
    const fs = H * 0.04;
    ctx.save();
    ctx.font = `200 ${fs}px "Raleway", "Helvetica Neue", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const ty = position === 'bottom' ? H * 0.94 : H * 0.055;
    const g = ctx.createLinearGradient(0, ty - H * 0.035, 0, ty + H * 0.035);
    g.addColorStop(0, `rgba(${INK},0.75)`);
    g.addColorStop(1, `rgba(${INK},0.25)`);
    ctx.fillStyle = g;
    const pad = W * 0.035;
    const step = chars.length > 1 ? (W - 2 * pad) / (chars.length - 1) : 0;
    chars.forEach((ch, i) => ctx.fillText(ch, chars.length > 1 ? pad + i * step : W / 2, ty));
    ctx.restore();
  }
  corner = { left: 'bl', right: 'br' }[corner] || corner;
  const side = corner[1] === 'l' ? 'left' : 'right';
  const atTop = corner[0] === 't';
  const edge = atTop ? (position === 'top' ? H * 0.11 : H * 0.025) : position === 'bottom' ? H * 0.875 : H - H * 0.02;
  const lines = credits ? credits.split('\n') : [];
  const fs = Math.max(9, H * 0.011);
  ctx.save();
  ctx.font = `300 ${fs}px "Raleway", "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = side;
  ctx.fillStyle = `rgba(${INK},0.35)`;
  const tx = side === 'left' ? W * 0.02 : W - W * 0.02;
  let anchor;
  if (atTop) {
    ctx.textBaseline = 'top';
    lines.forEach((l, i) => ctx.fillText(l, tx, edge + i * fs * 1.5));
    anchor = { y: edge + lines.length * fs * 1.5 + (lines.length ? fs * 0.6 : 0), place: 'below', side };
  } else {
    ctx.textBaseline = 'bottom';
    lines.forEach((l, i) => ctx.fillText(l, tx, edge - (lines.length - 1 - i) * fs * 1.5));
    anchor = { y: lines.length ? edge - (lines.length - 1) * fs * 1.5 - fs * 1.2 : edge, place: 'above', side };
  }
  ctx.restore();
  return anchor;
}

// Round scale-bar length.
function nice(x) {
  const p = 10 ** Math.floor(Math.log10(x));
  for (const m of [5, 2, 1]) if (m * p <= x) return m * p;
  return p;
}

// Distance scale bar.
export function drawScaleBar(ctx, W, H, pxPerMeter, units, anchor, side = anchor?.side || 'right') {
  if (typeof anchor === 'number') anchor = { y: anchor, place: 'above' };
  if (!pxPerMeter || !units || units === 'off') return;
  const target = W * 0.11;
  const rows = [];
  if (units !== 'imperial') {
    const big = target / pxPerMeter >= 1000;
    const u = big ? 1000 : 1;
    rows.push({ v: nice(target / pxPerMeter / u), u, label: big ? 'km' : 'm' });
  }
  if (units !== 'metric') {
    const big = target / pxPerMeter >= 1609.344;
    const u = big ? 1609.344 : 0.3048;
    rows.push({ v: nice(target / pxPerMeter / u), u, label: big ? 'mi' : 'ft' });
  }
  const fs = Math.max(9, H * 0.0115);
  const barH = Math.max(3, H * 0.0045);
  const rowH = fs * 1.5 + barH + H * 0.006;
  const unitW = fs * 1.8;
  const top = anchor.place === 'below' ? anchor.y + fs * 1.4 : anchor.y - rows.length * rowH;
  const right = W - W * 0.02;
  ctx.save();
  ctx.font = `300 ${fs}px "Raleway", "Helvetica Neue", Arial, sans-serif`;
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = `rgba(${INK},0.4)`;
  ctx.textAlign = side === 'left' ? 'left' : 'right';
  ctx.fillText('scale at block centre', side === 'left' ? W * 0.02 : right, top - fs * 0.2);
  rows.forEach((r, i) => {
    const len = r.v * r.u * pxPerMeter;
    const x0 = side === 'left' ? W * 0.02 : right - unitW - len;
    const x1 = x0 + len;
    const barY = top + i * rowH + fs * 1.4;
    for (let s = 0; s < 4; s++) {
      ctx.fillStyle = s % 2 ? `rgba(${INK},0.15)` : `rgba(${INK},0.75)`;
      ctx.fillRect(x0 + (len * s) / 4, barY, len / 4, barH);
    }
    ctx.strokeStyle = `rgba(${INK},0.75)`;
    ctx.lineWidth = Math.max(1, H * 0.0008);
    ctx.strokeRect(x0, barY, len, barH);
    ctx.fillStyle = `rgba(${INK},0.6)`;
    ctx.textAlign = 'center';
    for (const s of [0, 2, 4]) ctx.fillText(String(Number(((r.v * s) / 4).toPrecision(3))), x0 + (len * s) / 4, barY - fs * 0.15);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(r.label, x1 + fs * 0.5, barY + barH / 2);
    ctx.textBaseline = 'bottom';
  });
  ctx.restore();
}
