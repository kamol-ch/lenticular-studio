// Layer compositing with motion effects and layer-mode depth shifts (browser).
// Renders the card's bleed box into a target canvas of any pixel size; the
// target may be anisotropic (working-resolution frames are).

import { bleedBoxPx, axisOf, mmToPx } from './core/geometry.js';
import { IDENTITY, stateForTarget } from './core/motion.js';
import { layerShiftPx } from './core/warp.js';
import { computePlan } from './core/planner.js';
import { lpiInUse } from './core/geometry.js';
import { makeCanvas, ctx2d } from './canvas.js';

export const MASK_TARGET = '__mask';

const maskCentres = new WeakMap();

function maskCentre(mask) {
  if (maskCentres.has(mask)) return maskCentres.get(mask);
  const small = makeCanvas(Math.min(256, mask.width), Math.min(256, mask.height));
  const x = ctx2d(small, { willReadFrequently: true });
  x.drawImage(mask, 0, 0, small.width, small.height);
  const d = x.getImageData(0, 0, small.width, small.height).data;
  let sx = 0, sy = 0, sw = 0;
  for (let y = 0; y < small.height; y++) for (let i = 0; i < small.width; i++) {
    const w = d[(y * small.width + i) * 4 + 3] / 255;
    sx += i * w; sy += y * w; sw += w;
  }
  const c = sw ? { u: (sx / sw + 0.5) / small.width, v: (sy / sw + 0.5) / small.height } : { u: 0.5, v: 0.5 };
  maskCentres.set(mask, c);
  return c;
}

export function invalidateMaskCentre(mask) { if (mask) maskCentres.delete(mask); }

export function depthBudgetPx(state) {
  return computePlan({
    ppi: state.printer.ppi, lpi: lpiInUse(state.lens), frames: state.plan.frames,
    viewingAngleDeg: state.lens.angleDeg, card: state.card,
    budgetLensPerFrame: state.plan.budgetLensPerFrame,
  }).maxShiftPxPerFrame;
}

/** Cheap blur that works everywhere: shrink then enlarge. */
function softBlur(src, factor = 24) {
  const tiny = makeCanvas(Math.max(2, src.width / factor), Math.max(2, src.height / factor));
  const t = ctx2d(tiny);
  t.imageSmoothingQuality = 'high';
  t.drawImage(src, 0, 0, tiny.width, tiny.height);
  const out = makeCanvas(src.width, src.height);
  const o = ctx2d(out);
  o.imageSmoothingQuality = 'high';
  o.drawImage(tiny, 0, 0, out.width, out.height);
  return out;
}

/**
 * @param {HTMLCanvasElement} target
 * @param {object} o
 * @param {object} o.state
 * @param {object} o.assets
 * @param {number} [o.frameIndex] frame i (for motion and depth); null = neutral
 * @param {number} [o.n] frame count
 * @param {boolean} [o.withMotion]
 * @param {boolean} [o.withDepth]
 * @param {string|null} [o.selectedId] draw a selection box
 */
export function renderComposite(target, { state, assets, frameIndex = null, n = state.plan.frames, withMotion = false, withDepth = false }) {
  const ctx = ctx2d(target);
  const { w: outW, h: outH } = bleedBoxPx(state.card, state.printer.ppi);
  const sx = target.width / outW, sy = target.height / outH;
  const ppi = state.printer.ppi;
  const effects = withMotion && frameIndex != null ? state.animation.effects.filter((e) => e.enabled !== false) : [];
  const axis = axisOf(state.orientation);
  const budget = withDepth ? depthBudgetPx(state) : 0;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, target.width, target.height);
  ctx.imageSmoothingQuality = 'high';

  for (const layer of state.layers) {
    if (!layer.visible) continue;
    const img = assets.layerImages[layer.id];
    if (!img) continue;
    const st = effects.length ? stateForTarget(effects, layer.id, frameIndex, n) : IDENTITY;
    let dx = mmToPx(st.dxMm, ppi), dy = mmToPx(st.dyMm, ppi);
    if (withDepth && frameIndex != null) {
      const shift = layerShiftPx(layer.depth, state.depth.keyPlane, state.depth.strength, budget, frameIndex, n);
      if (axis === 'x') dx += shift; else dy += shift;
    }
    const dw = layer.scale * outW;
    const dh = (dw * img.height) / img.width;
    ctx.setTransform(sx, 0, 0, sy, 0, 0);
    ctx.translate(layer.x * outW + dx, layer.y * outH + dy);
    if (st.rotateDeg) ctx.rotate((st.rotateDeg * Math.PI) / 180);
    if (st.scale !== 1) ctx.scale(st.scale, st.scale);
    ctx.globalAlpha = Math.max(0, Math.min(1, layer.opacity * st.opacity));
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;

  const maskEffects = effects.filter((e) => e.target === MASK_TARGET);
  const mask = assets.motionMask;
  if (maskEffects.length && mask) {
    const st = stateForTarget(maskEffects, MASK_TARGET, frameIndex, n);
    // Cut the painted region out as its own piece.
    const piece = makeCanvas(target.width, target.height);
    const p = ctx2d(piece);
    p.drawImage(target, 0, 0);
    p.globalCompositeOperation = 'destination-in';
    p.drawImage(mask, 0, 0, piece.width, piece.height);
    // Fill the hole with a soft blur of the surroundings so moved/faded parts don't double up.
    const fill = softBlur(target);
    const f = ctx2d(fill);
    f.globalCompositeOperation = 'destination-in';
    f.drawImage(mask, 0, 0, fill.width, fill.height);
    ctx.drawImage(fill, 0, 0);
    // Draw the moved piece.
    const c = maskCentre(mask);
    const cx = c.u * outW, cy = c.v * outH;
    ctx.setTransform(sx, 0, 0, sy, 0, 0);
    ctx.translate(cx + mmToPx(st.dxMm, ppi), cy + mmToPx(st.dyMm, ppi));
    if (st.rotateDeg) ctx.rotate((st.rotateDeg * Math.PI) / 180);
    if (st.scale !== 1) ctx.scale(st.scale, st.scale);
    ctx.translate(-cx, -cy);
    ctx.globalAlpha = st.opacity;
    ctx.drawImage(piece, 0, 0, outW, outH);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
  }
  return target;
}

/** Does the project have anything to build frames from? */
export function frameSource(state, assets) {
  if (state.animation.mode === 'clip' && assets.animFrames.length) return 'clip';
  if (state.layers.some((l) => assets.layerImages[l.id])) return 'layers';
  return null;
}

/** Base image (no depth) at frame i, at the requested size and true card aspect. */
export function renderBase(target, state, assets, i, n) {
  const src = frameSource(state, assets);
  if (src === 'clip') {
    const af = assets.animFrames;
    const idx = n <= 1 || af.length <= 1 ? 0 : Math.round((i * (af.length - 1)) / (n - 1));
    const ctx = ctx2d(target);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(af[idx], 0, 0, target.width, target.height);
    return target;
  }
  return renderComposite(target, { state, assets, frameIndex: i, n, withMotion: state.animation.mode === 'simple', withDepth: false });
}
