// Frame planner (plan §5 Step 2). Pure, DOM-free.

import { bleedBoxPx, pitchPx } from './geometry.js';

export const DEFAULT_VIEW_ANGLE_DEG = 32;

const rad2deg = (r) => (r * 180) / Math.PI;

/** Angle subtended by the two eyes at the viewing distance (≈ 9° at 40 cm). */
export function eyeAngleDeg(ipdMm = 63, viewDistMm = 400) {
  return rad2deg(2 * Math.atan(ipdMm / 2 / viewDistMm));
}

/**
 * Largest per-frame shift (output px) produced by the current depth settings.
 * shift/frame = (depth − keyPlane) × strength × budget, so it stays inside the
 * budget while |depth − keyPlane| × strength ≤ 1.
 */
export function depthUsage({ mode, keyPlane = 0, strength = 0, layers = [] }, budgetPx) {
  if (mode === 'none') return { pxPerFrame: 0, ratio: 0 };
  let maxAbs;
  if (mode === 'layers') {
    const ds = layers.filter((l) => l.visible !== false).map((l) => Math.abs((l.depth ?? 0) - keyPlane));
    maxAbs = ds.length ? Math.max(...ds) : 0;
  } else {
    // AI depth map spans the full range −1…1.
    maxAbs = Math.max(Math.abs(1 - keyPlane), Math.abs(-1 - keyPlane));
  }
  const ratio = maxAbs * strength;
  return { pxPerFrame: ratio * budgetPx, ratio };
}

export const MIN_FRAMES_BETWEEN_EYES = 1.5;
export const BUDGET_RANGE = { min: 0.1, max: 3 };
export const SAMPLES_RANGE = { min: 1, max: 8 };

/**
 * Usable frame counts. The maximum is one printed pixel per frame per lens.
 * For 3D the minimum keeps the eyes ≥ 1.5 frames apart; animation needs 2.
 */
export function frameRange({ maxFrames, eyeAngleDeg: eye, viewingAngleDeg: theta, effect }) {
  const wants3d = effect !== 'animation';
  const min3d = Math.ceil((MIN_FRAMES_BETWEEN_EYES * theta) / eye - 1e-9);
  const min = wants3d ? Math.max(2, Math.min(maxFrames, min3d)) : 2;
  return { min, max: maxFrames, wants3d, reachable: !wants3d || min3d <= maxFrames };
}

/**
 * @param {object} p
 * @param {number} p.ppi
 * @param {number} p.lpi            lpi in use (measured or nominal)
 * @param {number} p.frames
 * @param {number|null} p.viewingAngleDeg measured lens viewing angle, null if unknown
 * @param {object} p.card
 * @param {string} p.effect         '3d' | 'animation' | '3d-motion'
 */
export function computePlan({
  ppi, lpi, frames, viewingAngleDeg, card, effect = '3d',
  ipdMm = 63, viewDistMm = 400, budgetLensPerFrame = 1,
  depth = null, motionPxPerFrame = 0,
}) {
  const pitch = pitchPx(ppi, lpi);
  const maxFrames = Math.max(2, Math.floor(pitch));
  const angleKnown = viewingAngleDeg > 0;
  const theta = angleKnown ? viewingAngleDeg : DEFAULT_VIEW_ANGLE_DEG;
  const eye = eyeAngleDeg(ipdMm, viewDistMm);
  const framesBetweenEyes = (eye * frames) / theta;
  const maxShiftPxPerFrame = pitch * budgetLensPerFrame;
  const { w, h } = bleedBoxPx(card, ppi);
  const stripPx = pitch / frames;

  const warnings = [];
  const wants3d = effect !== 'animation';

  if (frames > maxFrames || stripPx < 1) {
    warnings.push({
      level: 'error', code: 'too-many-frames',
      text: `Too many frames for this resolution: each frame strip is ${stripPx.toFixed(2)} px. Use at most ${maxFrames} frames at ${ppi} ppi.`,
    });
  }
  if (wants3d && framesBetweenEyes < 1.5) {
    warnings.push({
      level: 'warn', code: 'weak-3d',
      text: `Weak 3D: only ${framesBetweenEyes.toFixed(2)} frames between the eyes (aim for ≥ 1.5). Add frames or use a lens with a narrower viewing angle.`,
    });
  }
  if (!angleKnown) {
    warnings.push({
      level: 'info', code: 'angle-estimated',
      text: `Viewing angle not measured yet; using ${DEFAULT_VIEW_ANGLE_DEG}° as an estimate. Print the viewing-angle test in Step 1.`,
    });
  }
  let depthInfo = null;
  if (depth) {
    depthInfo = depthUsage(depth, maxShiftPxPerFrame);
    if (depthInfo.ratio > 1.0001) {
      warnings.push({
        level: 'warn', code: 'blur-risk',
        text: `Heavy blur risk: depth settings shift ${depthInfo.pxPerFrame.toFixed(1)} px per frame, over the ${maxShiftPxPerFrame.toFixed(1)} px budget.`,
      });
    }
  }
  if (motionPxPerFrame > maxShiftPxPerFrame) {
    warnings.push({
      level: 'warn', code: 'ghosting-risk',
      text: `Ghosting risk: motion moves up to ${motionPxPerFrame.toFixed(1)} px between frames (budget ${maxShiftPxPerFrame.toFixed(1)} px).`,
    });
  }

  const range = frameRange({ maxFrames, eyeAngleDeg: eye, viewingAngleDeg: theta, effect });
  if (wants3d && !range.reachable) {
    warnings.push({
      level: 'warn', code: 'no-strong-3d',
      text: `This lens and printer cannot reach 1.5 frames between the eyes even at ${maxFrames} frames. Use a higher resolution or a lens with a narrower viewing angle for stronger 3D.`,
    });
  }

  return {
    pitchPx: pitch,
    maxFrames,
    frameRange: range,
    eyeAngleDeg: eye,
    viewingAngleDeg: theta,
    angleKnown,
    framesBetweenEyes,
    maxShiftPxPerFrame,
    totalParallaxPx: maxShiftPxPerFrame * (frames - 1),
    stripPx,
    outputPx: { w, h },
    lensCount: { x: w / pitch, y: h / pitch },
    depth: depthInfo,
    warnings,
  };
}
