// Depth-map sources: in-browser AI estimate (Depth Anything via transformers.js)
// and a map painted from layer silhouettes.

import { bleedBoxPx } from './core/geometry.js';
import { makeCanvas, ctx2d, canvasToBlob, imageDataOf } from './canvas.js';

const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2';
const DEPTH_MODEL = 'onnx-community/depth-anything-v2-small';

let depthPipeline = null;

export async function estimateDepth(srcCanvas, onProgress) {
  onProgress(0.02, 'Loading transformers.js…');
  let lib;
  try { lib = await import(TRANSFORMERS_URL); }
  catch { throw new Error('Could not load transformers.js from the CDN (offline?). You can paint or import a depth map instead.'); }
  if (!depthPipeline) {
    const files = new Map();
    depthPipeline = await lib.pipeline('depth-estimation', DEPTH_MODEL, {
      progress_callback: (p) => {
        if (p.status === 'progress' && p.total) {
          files.set(p.file, [p.loaded, p.total]);
          let l = 0, t = 0;
          for (const [a, b] of files.values()) { l += a; t += b; }
          onProgress(0.05 + 0.75 * (l / t), `Downloading model (first time only) ${Math.round(l / 1e6)}/${Math.round(t / 1e6)} MB`);
        }
      },
    });
  }
  onProgress(0.85, 'Estimating depth…');
  const url = URL.createObjectURL(await canvasToBlob(srcCanvas));
  try {
    const img = await lib.RawImage.fromURL(url);
    const out = await depthPipeline(img);
    const d = out.depth;
    const ch = d.channels || 1;
    const data = new Uint8Array(d.width * d.height);
    for (let i = 0; i < data.length; i++) data[i] = d.data[i * ch];
    return { w: d.width, h: d.height, data };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Depth map painted from layer silhouettes and their depth values. */
export function depthFromLayers(state, assets, W, H) {
  const { w: outW, h: outH } = bleedBoxPx(state.card, state.printer.ppi);
  const c = makeCanvas(W, H);
  const x = ctx2d(c, { willReadFrequently: true });
  x.fillStyle = '#000';
  x.fillRect(0, 0, W, H);
  for (const l of state.layers) {
    const img = assets.layerImages[l.id];
    if (!l.visible || !img) continue;
    const g = Math.round(((l.depth + 1) / 2) * 255);
    const t = makeCanvas(W, H);
    const tx = ctx2d(t);
    tx.setTransform(W / outW, 0, 0, H / outH, 0, 0);
    const dw = l.scale * outW, dh = (dw * img.height) / img.width;
    tx.drawImage(img, l.x * outW - dw / 2, l.y * outH - dh / 2, dw, dh);
    tx.setTransform(1, 0, 0, 1, 0, 0);
    tx.globalCompositeOperation = 'source-in';
    tx.fillStyle = `rgb(${g},${g},${g})`;
    tx.fillRect(0, 0, W, H);
    x.drawImage(t, 0, 0);
  }
  const d = imageDataOf(c).data;
  const data = new Uint8Array(W * H);
  for (let i = 0; i < data.length; i++) data[i] = d[i * 4];
  return { w: W, h: H, data };
}
