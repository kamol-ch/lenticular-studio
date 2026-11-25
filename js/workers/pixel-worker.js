// Heavy pixel work off the main thread: interlacing + PNG encoding, depth warps.

import { createInterlacer } from '../core/interlace.js';
import { encodePng } from '../core/png.js';
import { forwardWarp } from '../core/warp.js';
import { resampleToSigned } from '../core/depthmap.js';

let frames = null; // [{ width, height, data }]

const ops = {
  setFrames({ frames: fs }) {
    frames = fs.map((f) => ({ width: f.width, height: f.height, data: new Uint8ClampedArray(f.buffer) }));
    return { count: frames.length };
  },

  clearFrames() { frames = null; return true; },

  async interlace({ params }, progress) {
    if (!frames) throw new Error('No frames loaded in worker.');
    const il = createInterlacer({ ...params, frames });
    const blob = await encodePng({
      width: il.width, height: il.height, ppi: params.ppi,
      filter: params.orientation === 'horizontal' ? 'sub' : 'up',
      getRow: il.renderRow,
      onProgress: progress,
    });
    return { blob, width: il.width, height: il.height, placements: il.placements.length, cols: il.cols, rows: il.rows, landscape: il.landscape, marginPx: il.marginPx };
  },

  /** A 1:1 crop of the interlaced output (for the zoom preview). */
  preview({ params, x0, y0, w, h }) {
    if (!frames) throw new Error('No frames loaded in worker.');
    const il = createInterlacer({ ...params, frames });
    x0 = Math.max(0, Math.min(il.width - w, Math.round(x0)));
    y0 = Math.max(0, Math.min(il.height - h, Math.round(y0)));
    w = Math.min(w, il.width); h = Math.min(h, il.height);
    const row = new Uint8Array(il.width * 3);
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      il.renderRow(y0 + y, row);
      for (let x = 0; x < w; x++) {
        const s = (x0 + x) * 3, d = (y * w + x) * 4;
        out[d] = row[s]; out[d + 1] = row[s + 1]; out[d + 2] = row[s + 2]; out[d + 3] = 255;
      }
    }
    return { transfer: [out.buffer], value: { buffer: out.buffer, w, h, x0, y0, pageW: il.width, pageH: il.height } };
  },

  warp({ items, width, height, keyPlane, axis }, progress) {
    const outs = items.map((it, i) => {
      // Resampled one frame at a time, so only one full-size depth array exists at once.
      const d = resampleToSigned({ w: it.map.w, h: it.map.h, data: new Uint8Array(it.map.data) }, width, height);
      const r = forwardWarp({ src: new Uint8ClampedArray(it.buffer), depth: d, width, height, gain: it.gain, keyPlane, axis });
      progress((i + 1) / items.length);
      return r.buffer;
    });
    return { transfer: outs, value: outs };
  },
};

self.onmessage = async (e) => {
  const { id, op, payload } = e.data;
  const progress = (p) => self.postMessage({ id, progress: p });
  try {
    if (!ops[op]) throw new Error(`Unknown op ${op}`);
    const r = await ops[op](payload, progress);
    if (r && r.transfer) self.postMessage({ id, result: r.value }, r.transfer);
    else self.postMessage({ id, result: r });
  } catch (err) {
    self.postMessage({ id, error: err?.message || String(err) });
  }
};
