// Depth-map editing: brushes, smoothing and edge cleanup. Pure, DOM-free.
// Maps are Uint8Array grayscale, 0 = far, 255 = near.

export function createDepthMap(w, h, value = 128) {
  return { w, h, data: new Uint8Array(w * h).fill(value) };
}

/** Separable box blur, radius r (in place, returns map). */
export function boxBlur(map, r) {
  r = Math.round(r);
  if (r < 1) return map;
  const { w, h, data } = map;
  const tmp = new Float32Array(w * h);
  const win = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0;
    const row = y * w;
    for (let x = -r; x <= r; x++) acc += data[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / win;
      acc += data[row + Math.min(w - 1, x + r + 1)] - data[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      data[y * w + x] = Math.round(acc / win);
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return map;
}

/** Grey-level dilation (max filter): grows near regions so foreground edges cover halos. */
export function dilate(map, r) {
  r = Math.round(r);
  if (r < 1) return map;
  const { w, h, data } = map;
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0;
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
      for (let k = x0; k <= x1; k++) { const v = data[y * w + k]; if (v > m) m = v; }
      tmp[y * w + x] = m;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let m = 0;
      const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
      for (let k = y0; k <= y1; k++) { const v = tmp[k * w + x]; if (v > m) m = v; }
      data[y * w + x] = m;
    }
  }
  return map;
}

export function edgeCleanup(map, { dilateRadius = 2, blurRadius = 2 } = {}) {
  dilate(map, dilateRadius);
  boxBlur(map, blurRadius);
  return map;
}

/**
 * Soft round brush.
 * mode: 'near' (raise), 'far' (lower), 'smooth' (blend toward local mean), 'set' (toward value)
 */
export function applyBrush(map, cx, cy, radius, strength, mode, value = 128) {
  const { w, h, data } = map;
  const r = Math.max(1, radius);
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h - 1, Math.ceil(cy + r));
  let mean = 0;
  if (mode === 'smooth') {
    let sum = 0, cnt = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) { sum += data[y * w + x]; cnt++; }
    }
    mean = cnt ? sum / cnt : 0;
  }
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, y - cy) / r;
      if (d > 1) continue;
      const f = strength * (1 - d * d); // soft falloff
      const i = y * w + x;
      const v = data[i];
      let nv = v;
      if (mode === 'near') nv = v + f * 255 * 0.25;
      else if (mode === 'far') nv = v - f * 255 * 0.25;
      else if (mode === 'smooth') nv = v + (mean - v) * f;
      else if (mode === 'set') nv = v + (value - v) * f;
      data[i] = Math.max(0, Math.min(255, Math.round(nv)));
    }
  }
}

/** Bilinear resample to a new size, returning Float32 depth in −1…1. */
export function resampleToSigned(map, W, H) {
  const out = new Float32Array(W * H);
  const { w, h, data } = map;
  for (let y = 0; y < H; y++) {
    const fy = Math.min(h - 1, Math.max(0, ((y + 0.5) * h) / H - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(h - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.min(w - 1, Math.max(0, ((x + 0.5) * w) / W - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(w - 1, x0 + 1), tx = fx - x0;
      const a = data[y0 * w + x0] * (1 - tx) + data[y0 * w + x1] * tx;
      const b = data[y1 * w + x0] * (1 - tx) + data[y1 * w + x1] * tx;
      out[y * W + x] = ((a * (1 - ty) + b * ty) / 255) * 2 - 1;
    }
  }
  return out;
}

/**
 * Smooth a sequence of depth maps over time, to calm the frame-to-frame
 * flicker of per-frame AI estimates. Each map becomes a weighted mix with its
 * neighbours: (w·prev + cur + w·next) / (1 + 2w), with the ends using only the
 * neighbour they have. Maps of different sizes are left alone. Returns new maps.
 */
export function temporalSmooth(maps, weight = 0.5) {
  return maps.map((m, i) => {
    if (!m) return m;
    const nb = [maps[i - 1], maps[i + 1]].filter((o) => o && o.w === m.w && o.h === m.h);
    if (!nb.length || weight <= 0) return { w: m.w, h: m.h, data: m.data.slice() };
    const out = new Uint8Array(m.data.length);
    const norm = 1 + weight * nb.length;
    for (let p = 0; p < out.length; p++) {
      let s = m.data[p];
      for (const o of nb) s += weight * o.data[p];
      out[p] = Math.round(s / norm);
    }
    return { w: m.w, h: m.h, data: out };
  });
}
