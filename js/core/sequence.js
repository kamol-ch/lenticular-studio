// Video frame sequencing and alignment (plan §5 Step 4a). Pure, DOM-free.

/**
 * Which source frames to extract and in what order.
 * Ping-pong: extract m frames and play 0…m−1…1 so tilting back and forth loops.
 * @returns {{extract:number, order:number[]}}
 */
export function frameOrder(n, pingPong) {
  if (!pingPong || n < 3) return { extract: n, order: Array.from({ length: n }, (_, i) => i) };
  const m = Math.floor(n / 2) + 1;
  const order = [];
  for (let i = 0; i < m; i++) order.push(i);
  for (let i = m - 2; i >= 1; i--) order.push(i);
  while (order.length < n) order.splice(m, 0, m - 1); // odd n: hold the turnaround frame
  return { extract: m, order: order.slice(0, n) };
}

/** m evenly spaced times from start to end inclusive. */
export function evenlySpacedTimes(start, end, m) {
  if (m <= 1) return [start];
  return Array.from({ length: m }, (_, i) => start + ((end - start) * i) / (m - 1));
}

/**
 * Translation that best aligns `gray` to `ref` (sum of absolute differences,
 * brute force over ±maxShift on a coarse grid). Both are w×h luminance arrays.
 * @returns {{dx:number, dy:number}} shift to apply to `gray`
 */
export function estimateShift(ref, gray, w, h, maxShift = 12, step = 2) {
  let best = { dx: 0, dy: 0, err: Infinity };
  const m = maxShift;
  for (let dy = -m; dy <= m; dy++) {
    for (let dx = -m; dx <= m; dx++) {
      let err = 0, cnt = 0;
      for (let y = m; y < h - m; y += step) {
        const ry = y * w, gy = (y - dy) * w;
        for (let x = m; x < w - m; x += step) {
          err += Math.abs(ref[ry + x] - gray[gy + x - dx]);
          cnt++;
        }
      }
      err /= cnt || 1;
      if (err < best.err - 1e-9 || (Math.abs(err - best.err) < 1e-9 && Math.abs(dx) + Math.abs(dy) < Math.abs(best.dx) + Math.abs(best.dy))) {
        best = { dx, dy, err };
      }
    }
  }
  return { dx: best.dx, dy: best.dy };
}

export function toGray(rgba, w, h) {
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  return g;
}

/** Nearest index when the frame count changed after extraction. */
export function resampleIndex(i, n, have) {
  if (have <= 1 || n <= 1) return 0;
  return Math.round((i * (have - 1)) / (n - 1));
}
