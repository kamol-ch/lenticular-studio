// Live, low-resolution frames for the canvas: what the lens will show, rebuilt
// automatically whenever the project changes. Full-resolution frames are only
// built for printing (pipeline.js).

import { bleedBoxPx, axisOf } from './core/geometry.js';
import { resampleToSigned } from './core/depthmap.js';
import { forwardWarp, viewGain } from './core/warp.js';
import { makeCanvas, ctx2d } from './canvas.js';
import { renderBase, renderComposite, frameSource, depthBudgetPx, depthMapForFrame } from './compose.js';

export function renderPreviewFrames(state, assets, maxSide = 640) {
  const src = frameSource(state, assets);
  if (!src) return [];
  const { w: outW, h: outH } = bleedBoxPx(state.card, state.printer.ppi);
  const k = Math.min(1, maxSide / Math.max(outW, outH));
  const W = Math.max(2, Math.round(outW * k)), H = Math.max(2, Math.round(outH * k));
  const n = state.plan.frames, mode = state.depth.mode;
  const frames = [];
  for (let i = 0; i < n; i++) {
    const c = makeCanvas(W, H);
    if (mode === 'layers' && src === 'layers') renderComposite(c, { state, assets, frameIndex: i, n, withMotion: state.animation.mode === 'simple', withDepth: true });
    else renderBase(c, state, assets, i, n);
    frames.push(c);
  }
  if (mode === 'ai') {
    const axis = axisOf(state.orientation);
    const budget = depthBudgetPx(state) * k;
    const resampled = new Map(); // one resample per distinct map
    frames.forEach((c, i) => {
      const map = depthMapForFrame(state, assets, i, n);
      if (!map) return;
      if (!resampled.has(map)) resampled.set(map, resampleToSigned(map, W, H));
      const depth = resampled.get(map);
      const x = ctx2d(c, { willReadFrequently: true });
      const img = x.getImageData(0, 0, W, H);
      const out = forwardWarp({ src: img.data, depth, width: W, height: H, gain: viewGain(i, n, state.depth.strength, budget), keyPlane: state.depth.keyPlane, axis });
      x.putImageData(new ImageData(out, W, H), 0, 0);
    });
  }
  return frames;
}

/** Cached preview frames, re-rendered only when the project's frame inputs change. */
export function createLivePreview(store, maxSide = 640) {
  let frames = [], sig = null;
  return {
    frames() {
      const now = store.inputSig();
      if (now !== sig) { frames = renderPreviewFrames(store.state, store.assets, maxSide); sig = now; }
      return frames;
    },
  };
}
