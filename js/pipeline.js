// Frame building and interlacing orchestration (browser).

import { store } from './store.js';
import { frameGeometry, framesSignature, bleedBoxPx, lpiInUse } from './core/geometry.js';
import { resampleToSigned } from './core/depthmap.js';
import { viewGain } from './core/warp.js';
import { makeCanvas, ctx2d, imageDataOf, drawCover } from './canvas.js';
import { renderBase, renderComposite, frameSource, depthBudgetPx } from './compose.js';
import { callWorker, loadFramesIntoWorker, forgetWorkerFrames } from './worker-client.js';

let framesVersion = 0;

/** Build the final per-view frames from Steps 3–5 at working resolution. */
export async function buildFinalFrames(onProgress = () => {}) {
  const { state, assets } = store;
  const g = frameGeometry(state);
  const n = g.n;
  const src = frameSource(state, assets);
  if (!src) throw new Error('Nothing to build from: add images in Step 3, a clip in Step 4, or import frames in Step 6.');
  const depthMode = state.depth.mode;
  if (depthMode === 'ai' && !assets.depthMap) throw new Error('AI depth mode is on but there is no depth map yet (Step 5).');
  if (depthMode === 'layers' && src === 'clip') throw new Error('Layer depth needs layers; a video clip has none. Use AI depth for clips.');

  const frames = [];
  for (let i = 0; i < n; i++) {
    const c = makeCanvas(g.fw, g.fh);
    if (depthMode === 'layers') {
      renderComposite(c, { state, assets, frameIndex: i, n, withMotion: state.animation.mode === 'simple', withDepth: true });
    } else {
      renderBase(c, state, assets, i, n);
    }
    frames.push(c);
    onProgress((i + 1) / n * (depthMode === 'ai' ? 0.3 : 1), `Rendering frame ${i + 1}/${n}`);
    await new Promise((r) => setTimeout(r, 0));
  }

  if (depthMode === 'ai') {
    const depth = resampleToSigned(assets.depthMap, g.fw, g.fh);
    const budgetWorking = depthBudgetPx(state) * (g.axis === 'x' ? g.sx : g.sy);
    const items = frames.map((c, i) => {
      const img = imageDataOf(c);
      return { buffer: img.data.buffer, gain: viewGain(i, n, state.depth.strength, budgetWorking) };
    });
    const out = await callWorker('warp', {
      items, depth: depth.buffer, width: g.fw, height: g.fh, keyPlane: state.depth.keyPlane, axis: g.axis,
    }, {
      transfer: [...items.map((it) => it.buffer), depth.buffer],
      onProgress: (p) => onProgress(0.3 + 0.7 * p, 'Synthesising views'),
    });
    out.forEach((buf, i) => {
      ctx2d(frames[i]).putImageData(new ImageData(new Uint8ClampedArray(buf), g.fw, g.fh), 0, 0);
    });
  }

  setFrames(frames, 'built');
  return frames;
}

export function setFrames(frames, source) {
  framesVersion++;
  forgetWorkerFrames();
  store.setAssets({ frames, framesSig: framesSignature(store.state), framesSource: source, output: null, outputInfo: null });
}

/**
 * Import arbitrary images as final frames: cover-fit to the card at working
 * resolution. With `meta` (our own frames.zip) they are stretched instead.
 */
export async function importFrameImages(blobs, { workingRes = false } = {}) {
  const g = frameGeometry(store.state);
  const { w: outW, h: outH } = bleedBoxPx(store.state.card, store.state.printer.ppi);
  const frames = [];
  for (const b of blobs) {
    const bmp = await createImageBitmap(b);
    const c = makeCanvas(g.fw, g.fh);
    const x = ctx2d(c);
    x.fillStyle = '#fff';
    x.fillRect(0, 0, g.fw, g.fh);
    x.imageSmoothingQuality = 'high';
    if (workingRes) {
      x.drawImage(bmp, 0, 0, g.fw, g.fh);
    } else {
      // cover-fit in card space, then squash to working res
      x.setTransform(g.fw / outW, 0, 0, g.fh / outH, 0, 0);
      drawCover(x, bmp, outW, outH);
    }
    bmp.close?.();
    frames.push(c);
  }
  return frames;
}

/** Parameters for the interlacer from current state. */
export function interlaceParams(state = store.state, overrides = {}) {
  const ppi = state.printer.ppi;
  const lpi = lpiInUse(state.lens);
  const b = bleedBoxPx(state.card, ppi);
  return {
    outW: b.w, outH: b.h, bleedPx: b.bleedPx,
    pitch: ppi / lpi, ppi,
    orientation: state.orientation,
    reverse: state.interlace.reverse,
    phaseOffset: state.interlace.phaseOffset,
    marks: state.interlace.marks,
    marginMm: state.interlace.marginMm,
    tile: state.interlace.tileOnMedia,
    media: state.media,
    ...overrides,
  };
}

/** Interlace canvases → PNG blob with embedded ppi. */
export async function interlaceCanvases(canvases, params, onProgress, key = null) {
  await loadFramesIntoWorker(canvases, key);
  return callWorker('interlace', { params }, { onProgress });
}

export async function interlaceCurrentFrames(onProgress) {
  const { frames } = store.assets;
  if (!frames.length) throw new Error('No frames to interlace.');
  return interlaceCanvases(frames, interlaceParams(), onProgress, `frames:${framesVersion}`);
}

export async function previewCrop(x0, y0, w, h) {
  const { frames } = store.assets;
  await loadFramesIntoWorker(frames, `frames:${framesVersion}`);
  return callWorker('preview', { params: interlaceParams(), x0, y0, w, h });
}
