// View synthesis by forward warping with z-ordering (plan §5 Step 5). Pure.
//
// Depth values are in −1 (far) … +1 (near). For viewpoint offset `gain`
// (pixels per depth unit, already multiplied by strength, budget and
// (frame − centre)), a pixel moves by  −(depth − keyPlane) × gain  along the
// parallax axis. Holes left at depth edges are filled by stretching the
// farther neighbour (background stretch).

const SURFACE_JUMP = 0.08; // depth step treated as an edge (no span fill across it)

/**
 * @param {object} o
 * @param {Uint8Array|Uint8ClampedArray} o.src RGBA
 * @param {Float32Array} o.depth per-pixel depth in −1…1
 * @param {number} o.width
 * @param {number} o.height
 * @param {number} o.gain px per depth unit for this view (signed)
 * @param {number} [o.keyPlane=0]
 * @param {'x'|'y'} [o.axis='x']
 * @returns {Uint8ClampedArray} RGBA
 */
export function forwardWarp({ src, depth, width, height, gain, keyPlane = 0, axis = 'x' }) {
  const out = new Uint8ClampedArray(width * height * 4);
  const alongX = axis === 'x';
  const lines = alongX ? height : width;
  const len = alongX ? width : height;
  const pixStride = alongX ? 1 : width;
  const lineStride = alongX ? width : 1;

  const z = new Float32Array(len);
  const pos = new Float32Array(len);
  const filled = new Uint8Array(len);
  const col = new Uint8ClampedArray(len * 4);

  for (let line = 0; line < lines; line++) {
    const base = line * lineStride;
    z.fill(-Infinity);
    filled.fill(0);
    for (let j = 0; j < len; j++) {
      const p = base + j * pixStride;
      pos[j] = j - (depth[p] - keyPlane) * gain;
    }
    const write = (t, zz, p, q, f) => {
      if (t < 0 || t >= len || zz <= z[t]) return;
      z[t] = zz; filled[t] = 1;
      const o = t * 4, a = p * 4;
      if (q < 0 || f === 0) {
        col[o] = src[a]; col[o + 1] = src[a + 1]; col[o + 2] = src[a + 2]; col[o + 3] = src[a + 3];
      } else {
        const b = q * 4, g = 1 - f;
        col[o] = src[a] * g + src[b] * f; col[o + 1] = src[a + 1] * g + src[b + 1] * f;
        col[o + 2] = src[a + 2] * g + src[b + 2] * f; col[o + 3] = src[a + 3] * g + src[b + 3] * f;
      }
    };
    for (let j = 0; j < len; j++) {
      const p = base + j * pixStride;
      const d0 = depth[p];
      write(Math.round(pos[j]), d0, p, -1, 0);
      if (j + 1 < len) {
        const q = p + pixStride;
        const d1 = depth[q];
        if (Math.abs(d1 - d0) < SURFACE_JUMP) {
          // Continuous surface: fill the span between the two projected samples.
          const a = pos[j], b = pos[j + 1];
          const lo = Math.ceil(Math.min(a, b)), hi = Math.floor(Math.max(a, b));
          const span = b - a;
          for (let t = lo; t <= hi; t++) {
            const f = span === 0 ? 0 : (t - a) / span;
            if (f <= 0 || f >= 1) continue;
            write(t, d0 + (d1 - d0) * f, p, q, f);
          }
        }
      }
    }
    // Background stretch into holes.
    let j = 0;
    while (j < len) {
      if (filled[j]) { j++; continue; }
      let k = j;
      while (k < len && !filled[k]) k++;
      const L = j - 1, R = k < len ? k : -1;
      let srcT = -1;
      if (L >= 0 && R >= 0) srcT = z[L] <= z[R] ? L : R;
      else srcT = L >= 0 ? L : R;
      for (let t = j; t < k; t++) {
        const o = t * 4;
        if (srcT >= 0) {
          const s = srcT * 4;
          col[o] = col[s]; col[o + 1] = col[s + 1]; col[o + 2] = col[s + 2]; col[o + 3] = col[s + 3];
        } else {
          col[o] = 255; col[o + 1] = 255; col[o + 2] = 255; col[o + 3] = 255;
        }
      }
      j = k;
    }
    for (let t = 0; t < len; t++) {
      const o = (base + t * pixStride) * 4, c = t * 4;
      out[o] = col[c]; out[o + 1] = col[c + 1]; out[o + 2] = col[c + 2]; out[o + 3] = col[c + 3];
    }
  }
  return out;
}

/** Gain (px per depth unit) for frame i of n. */
export function viewGain(i, n, strength, budgetPx) {
  const c = (n - 1) / 2;
  return strength * budgetPx * (i - c);
}

/** Layer-mode shift (px) for a layer at `depth` in frame i of n. */
export function layerShiftPx(depth, keyPlane, strength, budgetPx, i, n) {
  return -(depth - keyPlane) * viewGain(i, n, strength, budgetPx);
}
