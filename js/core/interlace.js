// Fractional-pitch interlacing (plan §5 Step 6). Pure, DOM-free; runs in a worker.
//
// Each output pixel column (vertical ridges) or row (horizontal ridges) is
// assigned to a frame by where its centre falls inside its lens:
//   u = (pos + 0.5) / pitch + phaseOffset,  phase = frac(u),  k = floor(phase × N)
// With `reverse`, k → N−1−k (a lens flips its image, so the first viewpoint
// usually belongs on the far side of each lens).

import { mmToPx, tileLayout } from './geometry.js';

export function frameIndexAt(pos, pitch, n, reverse = false, phaseOffset = 0) {
  const u = (pos + 0.5) / pitch + phaseOffset;
  const phase = u - Math.floor(u);
  let k = Math.floor(phase * n);
  if (k >= n) k = n - 1;
  return reverse ? n - 1 - k : k;
}

export function buildIndexMap(length, pitch, n, { reverse = false, phaseOffset = 0 } = {}) {
  const map = new Uint8Array(length);
  for (let i = 0; i < length; i++) map[i] = frameIndexAt(i, pitch, n, reverse, phaseOffset);
  return map;
}

/**
 * Strips near each output position, for smooth edges and ink-spread
 * compensation. Strip m covers t ∈ [(m/n − phaseOffset)·pitch, ((m+1)/n − phaseOffset)·pitch)
 * in continuous page coordinates (pixel i spans [i, i+1)), which matches
 * frameIndexAt at pixel centres. For position i, entries start[i]…start[i+1]−1
 * list the strips that can reach [i, i+1] when boundaries move by up to
 * `reachPx`, with each strip's left boundary relative to i (bound[0] is unused).
 */
export function buildEdgeMap(length, pitch, n, { reverse = false, phaseOffset = 0, reachPx = 0 } = {}) {
  const start = new Uint32Array(length + 1);
  const frame = [], bound = [];
  const s = pitch / n;
  for (let i = 0; i < length; i++) {
    start[i] = frame.length;
    const m0 = Math.floor(n * ((i - reachPx) / pitch + phaseOffset));
    const m1 = Math.floor(n * ((i + 1 + reachPx) / pitch + phaseOffset) - 1e-9);
    for (let m = m0; m <= m1; m++) {
      const k = ((m % n) + n) % n;
      frame.push(reverse ? n - 1 - k : k);
      bound.push((m / n - phaseOffset) * pitch - i);
    }
  }
  start[length] = frame.length;
  return { start, frame: Uint8Array.from(frame), bound: Float32Array.from(bound), stripPx: s };
}

/**
 * Colour of one output pixel from the strips that cover it.
 * Each strip contributes its share of the pixel's width (smooth edges). With
 * spread > 0, every boundary moves `spread` px into the darker strip, so light
 * strips are printed wider by the amount the ink will later creep back.
 * vals: [r, g, b, lum] per strip, flat. Writes r, g, b into out[0..2].
 */
export function blendStrips(count, base, bound, vals, spread, out) {
  let r = 0, g = 0, b = 0;
  let lo = 0;
  for (let j = 0; j < count; j++) {
    let hi = 1;
    if (j < count - 1) {
      const lA = vals[j * 4 + 3], lB = vals[(j + 1) * 4 + 3];
      hi = bound[base + j + 1] + (lA > lB + 0.5 ? spread : lA < lB - 0.5 ? -spread : 0);
    }
    const w = Math.min(hi, 1) - Math.max(lo, 0);
    if (w > 0) { r += w * vals[j * 4]; g += w * vals[j * 4 + 1]; b += w * vals[j * 4 + 2]; }
    lo = hi;
    if (lo >= 1) break;
  }
  out[0] = r; out[1] = g; out[2] = b;
}

/** Nearest-sample lookup from output coordinates to frame coordinates. */
export function buildSampleMap(outLen, frameLen) {
  const m = new Uint32Array(outLen);
  const s = frameLen / outLen;
  for (let i = 0; i < outLen; i++) m[i] = Math.min(frameLen - 1, Math.floor((i + 0.5) * s));
  return m;
}

/**
 * Page layout: one card (optionally with a marks margin) or a grid on the paper.
 * Placements are the top-left corners of each card's bleed box, in page px.
 */
export function planPage({ outW, outH, marginPx = 0, tile = false, media, ppi = 720 }) {
  const cellW = outW + 2 * marginPx;
  const cellH = outH + 2 * marginPx;
  if (!tile) {
    return { pageW: cellW, pageH: cellH, placements: [{ x: marginPx, y: marginPx }], cols: 1, rows: 1 };
  }
  const t = tileLayout(cellW, cellH, ppi, media);
  if (t.cols < 1 || t.rows < 1) throw new Error('The card (with marks) does not fit on the paper; turn off tiling or choose larger paper.');
  const offX = Math.floor((t.pageW - t.cols * cellW) / 2);
  const offY = Math.floor((t.pageH - t.rows * cellH) / 2);
  const placements = [];
  for (let r = 0; r < t.rows; r++) {
    for (let c = 0; c < t.cols; c++) {
      placements.push({ x: offX + c * cellW + marginPx, y: offY + r * cellH + marginPx });
    }
  }
  return { pageW: t.pageW, pageH: t.pageH, placements, cols: t.cols, rows: t.rows, landscape: t.landscape };
}

/**
 * @param {object} o
 * @param {{width:number,height:number,data:Uint8Array|Uint8ClampedArray}[]} o.frames RGBA, all the same size
 * @param {number} o.outW  bleed-box width in output px
 * @param {number} o.outH  bleed-box height in output px
 * @param {number} o.pitch output px per lens
 * @param {'vertical'|'horizontal'} o.orientation ridge direction
 * @returns {{width:number,height:number,placements:object[],indexMap:Uint8Array,renderRow:(y:number,rgb:Uint8Array)=>void}}
 */
export function createInterlacer({
  frames, outW, outH, pitch, orientation = 'vertical', reverse = false, phaseOffset = 0,
  marks = false, marginMm = 8, tile = false, media, ppi = 720, bleedPx = 0, overlay = [],
  smoothEdges = false, spreadPx = 0, spreadRows = null,
}) {
  const n = frames.length;
  if (n < 1) throw new Error('No frames to interlace.');
  if (n > 255) throw new Error('Too many frames.');
  const fw = frames[0].width, fh = frames[0].height;
  for (const f of frames) {
    if (f.width !== fw || f.height !== fh) throw new Error('All frames must be the same size.');
  }
  const marginPx = marks ? Math.round(mmToPx(marginMm, ppi)) : 0;
  const page = planPage({ outW, outH, marginPx, tile, media, ppi });
  const { pageW, pageH, placements } = page;
  const vertical = orientation !== 'horizontal';

  // Phase is computed in page coordinates so every tiled card and the
  // registration strips share one continuous lens grid.
  const indexMap = buildIndexMap(vertical ? pageW : pageH, pitch, n, { reverse, phaseOffset });
  const srcX = buildSampleMap(outW, fw);
  const srcY = buildSampleMap(outH, fh);
  const datas = frames.map((f) => f.data);

  // Smooth edges / ink-spread compensation. Spread is capped below half a strip
  // so a dark strip between two lighter ones never disappears.
  const maxSpread = 0.45 * pitch / n;
  const capSpread = (v) => Math.max(0, Math.min(maxSpread, v || 0));
  const rowSpread = (spreadRows || []).map((r) => ({ y0: r.y0, y1: r.y1, px: capSpread(r.px) }));
  const baseSpread = capSpread(spreadPx);
  const reach = Math.max(baseSpread, ...rowSpread.map((r) => r.px));
  const soft = n > 1 && (smoothEdges || reach > 0);
  const edges = soft ? buildEdgeMap(vertical ? pageW : pageH, pitch, n, { reverse, phaseOffset, reachPx: reach + 1e-6 }) : null;
  const vals = new Float32Array(4 * 16);
  const mix = new Float32Array(3);
  const spreadAt = (y) => { for (const r of rowSpread) if (y >= r.y0 && y < r.y1) return r.px; return baseSpread; };

  /** Pixel o of frame f, composited on white, into vals[j]. */
  function sample(j, f, o) {
    const d = datas[f], a = d[o + 3], q = j * 4;
    let r = d[o], g = d[o + 1], b = d[o + 2];
    if (a !== 255) { const ia = 255 - a; r = (r * a + 255 * ia) / 255; g = (g * a + 255 * ia) / 255; b = (b * a + 255 * ia) / 255; }
    vals[q] = r; vals[q + 1] = g; vals[q + 2] = b; vals[q + 3] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  function softPixel(rgb, ro, pos, o, spread) {
    const s0 = edges.start[pos], cnt = Math.min(16, edges.start[pos + 1] - s0);
    for (let j = 0; j < cnt; j++) sample(j, edges.frame[s0 + j], o);
    if (cnt === 1) { rgb[ro] = vals[0]; rgb[ro + 1] = vals[1]; rgb[ro + 2] = vals[2]; return; }
    blendStrips(cnt, s0, edges.bound, vals, spread, mix);
    rgb[ro] = Math.round(mix[0]); rgb[ro + 1] = Math.round(mix[1]); rgb[ro + 2] = Math.round(mix[2]);
  }

  // Marks geometry (relative to a placement's bleed box).
  const lineW = Math.max(1, Math.round(ppi / 360));
  const gap = Math.round(mmToPx(1, ppi));
  const trimL = Math.round(bleedPx), trimR = Math.round(outW - bleedPx) - 1;
  const trimT = Math.round(bleedPx), trimB = Math.round(outH - bleedPx) - 1;
  // Distances measured outward from the bleed edge: crop ticks sit close to the
  // card, registration strips further out, so they never overlap.
  const tickEnd = Math.round(marginPx * 0.4);
  const stripA = Math.round(marginPx * 0.45), stripB = Math.round(marginPx * 0.9);
  const markLen = Math.max(0, tickEnd - gap);

  function put(rgb, x, v) { const o = x * 3; rgb[o] = v; rgb[o + 1] = v; rgb[o + 2] = v; }

  function renderCardRow(rgb, px, ly, y) {
    const sy = srcY[ly];
    const rowOff = sy * fw;
    if (soft) {
      const spread = spreadAt(y);
      for (let lx = 0; lx < outW; lx++) {
        const x = px + lx;
        softPixel(rgb, x * 3, vertical ? x : y, (rowOff + srcX[lx]) * 4, spread);
      }
      return;
    }
    if (vertical) {
      for (let lx = 0; lx < outW; lx++) {
        const x = px + lx;
        const d = datas[indexMap[x]];
        const o = (rowOff + srcX[lx]) * 4;
        const a = d[o + 3];
        const ro = x * 3;
        if (a === 255) { rgb[ro] = d[o]; rgb[ro + 1] = d[o + 1]; rgb[ro + 2] = d[o + 2]; }
        else {
          const ia = 255 - a;
          rgb[ro] = (d[o] * a + 255 * ia) / 255; rgb[ro + 1] = (d[o + 1] * a + 255 * ia) / 255; rgb[ro + 2] = (d[o + 2] * a + 255 * ia) / 255;
        }
      }
    } else {
      const d = datas[indexMap[y]];
      for (let lx = 0; lx < outW; lx++) {
        const o = (rowOff + srcX[lx]) * 4;
        const a = d[o + 3];
        const ro = (px + lx) * 3;
        if (a === 255) { rgb[ro] = d[o]; rgb[ro + 1] = d[o + 1]; rgb[ro + 2] = d[o + 2]; }
        else {
          const ia = 255 - a;
          rgb[ro] = (d[o] * a + 255 * ia) / 255; rgb[ro + 1] = (d[o + 1] * a + 255 * ia) / 255; rgb[ro + 2] = (d[o + 2] * a + 255 * ia) / 255;
        }
      }
    }
  }

  function renderMarksRow(rgb, px, py, y) {
    const ly = y - py; // may be negative (top margin) or ≥ outH (bottom margin)
    const inTop = ly < 0, inBottom = ly >= outH;
    if (inTop || inBottom) {
      const dist = inTop ? -ly : ly - outH + 1; // 1..margin
      // Vertical crop-mark ticks at the trim columns.
      if (dist > gap && dist <= gap + markLen) {
        for (let t = 0; t < lineW; t++) { put(rgb, px + trimL + t, 0); put(rgb, px + trimR - t, 0); }
      }
      // Registration strip for vertical ridges: frame-0 slot of every lens is black.
      if (vertical && dist > stripA && dist <= stripB) {
        for (let lx = 0; lx < outW; lx++) { const x = px + lx; if (indexMap[x] === 0) put(rgb, x, 0); }
      }
      return;
    }
    // Card rows: horizontal crop-mark ticks and registration strips in side margins.
    const onTrim = (ly >= trimT && ly < trimT + lineW) || (ly <= trimB && ly > trimB - lineW);
    for (let dist = 1; dist <= marginPx; dist++) {
      const xl = px - dist, xr = px + outW - 1 + dist;
      if (onTrim && dist > gap && dist <= gap + markLen) { put(rgb, xl, 0); put(rgb, xr, 0); }
      if (!vertical && dist > stripA && dist <= stripB && indexMap[y] === 0) { put(rgb, xl, 0); put(rgb, xr, 0); }
    }
  }

  function renderRow(y, rgb) {
    rgb.fill(255);
    for (const p of placements) {
      if (y < p.y - marginPx || y >= p.y + outH + marginPx) continue;
      const ly = y - p.y;
      if (ly >= 0 && ly < outH) renderCardRow(rgb, p.x, ly, y);
      if (marginPx > 0) renderMarksRow(rgb, p.x, p.y, y);
    }
    // Flat rectangles painted last, in page px (e.g. a test sheet's border and scale bar).
    for (const r of overlay) {
      if (y < r.y || y >= r.y + r.h) continue;
      const x0 = Math.max(0, r.x), x1 = Math.min(pageW, r.x + r.w);
      for (let x = x0; x < x1; x++) put(rgb, x, r.v);
    }
  }

  return { width: pageW, height: pageH, placements, marginPx, cols: page.cols, rows: page.rows, landscape: !!page.landscape, indexMap, renderRow };
}

/** Which frame is visible at a given tilt (tilt simulator). */
export function visibleFrameAtAngle(angleDeg, viewingAngleDeg, n) {
  const t = angleDeg / viewingAngleDeg + 0.5; // 0…1 across one viewing zone
  const phase = t - Math.floor(t);
  return Math.min(n - 1, Math.floor(phase * n));
}
