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

/** Nearest-sample lookup from output coordinates to frame coordinates. */
export function buildSampleMap(outLen, frameLen) {
  const m = new Uint32Array(outLen);
  const s = frameLen / outLen;
  for (let i = 0; i < outLen; i++) m[i] = Math.min(frameLen - 1, Math.floor((i + 0.5) * s));
  return m;
}

/**
 * Page layout: one card (optionally with a marks margin) or a grid on A4.
 * Placements are the top-left corners of each card's bleed box, in page px.
 */
export function planPage({ outW, outH, marginPx = 0, tileA4 = false, ppi = 720 }) {
  const cellW = outW + 2 * marginPx;
  const cellH = outH + 2 * marginPx;
  if (!tileA4) {
    return { pageW: cellW, pageH: cellH, placements: [{ x: marginPx, y: marginPx }], cols: 1, rows: 1 };
  }
  const t = tileLayout(cellW, cellH, ppi);
  if (t.cols < 1 || t.rows < 1) throw new Error('Card (with marks) is larger than A4; turn off tiling or reduce the card size.');
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
  marks = false, marginMm = 8, tileA4 = false, ppi = 720, bleedPx = 0,
}) {
  const n = frames.length;
  if (n < 1) throw new Error('No frames to interlace.');
  if (n > 255) throw new Error('Too many frames.');
  const fw = frames[0].width, fh = frames[0].height;
  for (const f of frames) {
    if (f.width !== fw || f.height !== fh) throw new Error('All frames must be the same size.');
  }
  const marginPx = marks ? Math.round(mmToPx(marginMm, ppi)) : 0;
  const page = planPage({ outW, outH, marginPx, tileA4, ppi });
  const { pageW, pageH, placements } = page;
  const vertical = orientation !== 'horizontal';

  // Phase is computed in page coordinates so every tiled card and the
  // registration strips share one continuous lens grid.
  const indexMap = buildIndexMap(vertical ? pageW : pageH, pitch, n, { reverse, phaseOffset });
  const srcX = buildSampleMap(outW, fw);
  const srcY = buildSampleMap(outH, fh);
  const datas = frames.map((f) => f.data);

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
  }

  return { width: pageW, height: pageH, placements, marginPx, cols: page.cols, rows: page.rows, landscape: !!page.landscape, indexMap, renderRow };
}

/** Which frame is visible at a given tilt (tilt simulator). */
export function visibleFrameAtAngle(angleDeg, viewingAngleDeg, n) {
  const t = angleDeg / viewingAngleDeg + 0.5; // 0…1 across one viewing zone
  const phase = t - Math.floor(t);
  return Math.min(n - 1, Math.floor(phase * n));
}
