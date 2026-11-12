// Unit conversions and card / frame geometry. Pure, DOM-free.

export const MM_PER_INCH = 25.4;
export const A4_MM = { w: 210, h: 297 };

export const mmToPx = (mm, ppi) => (mm / MM_PER_INCH) * ppi;
export const pxToMm = (px, ppi) => (px / ppi) * MM_PER_INCH;

/** LPI used for output: measured if the user has calibrated, else nominal. */
export function lpiInUse(lens) {
  return lens.lpiMeasured > 0 ? Number(lens.lpiMeasured) : Number(lens.lpiNominal);
}

/** Printed pixels per lens (fractional, e.g. 720 / 75 = 9.6). */
export function pitchPx(ppi, lpi) {
  return ppi / lpi;
}

/** Interlace axis: vertical ridges slice along x, horizontal ridges along y. */
export function axisOf(orientation) {
  return orientation === 'horizontal' ? 'y' : 'x';
}

/** Orientation implied by the effect type (plan §5 Step 1). */
export function orientationForEffect(effect) {
  return effect === 'animation' ? 'horizontal' : 'vertical';
}

/** Output size of one card including bleed, at the print resolution. */
export function bleedBoxPx(card, ppi) {
  const w = Math.round(mmToPx(card.widthMm + 2 * card.bleedMm, ppi));
  const h = Math.round(mmToPx(card.heightMm + 2 * card.bleedMm, ppi));
  return {
    w, h,
    bleedPx: mmToPx(card.bleedMm, ppi),
    trimW: mmToPx(card.widthMm, ppi),
    trimH: mmToPx(card.heightMm, ppi),
  };
}

/**
 * Working resolution for stored frames (plan §3, memory strategy):
 * ~`samplesPerLens` samples per lens along the interlace axis, and full
 * resolution (capped at `maxNonAxisPpi`) along the other axis.
 */
export function workingFrameSize({ card, ppi, lpi, orientation, samplesPerLens = 3, maxNonAxisPpi = 720 }) {
  const { w, h } = bleedBoxPx(card, ppi);
  const p = pitchPx(ppi, lpi);
  const nonAxis = Math.min(1, maxNonAxisPpi / ppi);
  let fw, fh;
  if (axisOf(orientation) === 'x') {
    fw = Math.min(w, Math.ceil((w / p) * samplesPerLens));
    fh = Math.max(1, Math.round(h * nonAxis));
  } else {
    fh = Math.min(h, Math.ceil((h / p) * samplesPerLens));
    fw = Math.max(1, Math.round(w * nonAxis));
  }
  return { fw, fh, outW: w, outH: h, sx: fw / w, sy: fh / h, lenses: (axisOf(orientation) === 'x' ? w : h) / p };
}

/** Everything that determines frame geometry, in one place, from project state. */
export function frameGeometry(state) {
  const lpi = lpiInUse(state.lens);
  const ppi = state.printer.ppi;
  const g = workingFrameSize({
    card: state.card, ppi, lpi,
    orientation: state.lens.orientation,
    samplesPerLens: state.plan.samplesPerLens,
  });
  return { ...g, ppi, lpi, pitch: pitchPx(ppi, lpi), axis: axisOf(state.lens.orientation), n: state.plan.frames };
}

/** A string that changes whenever stored frames would need rebuilding. */
export function framesSignature(state) {
  const g = frameGeometry(state);
  return JSON.stringify([g.fw, g.fh, g.outW, g.outH, g.axis, g.n]);
}

/** Pick portrait or landscape A4, whichever fits more cells. */
export function tileLayout(cellW, cellH, ppi) {
  const pw = Math.round(mmToPx(A4_MM.w, ppi));
  const ph = Math.round(mmToPx(A4_MM.h, ppi));
  const fit = (W, H) => ({ W, H, cols: Math.floor(W / cellW), rows: Math.floor(H / cellH) });
  const a = fit(pw, ph);
  const b = fit(ph, pw);
  const best = b.cols * b.rows > a.cols * a.rows ? b : a;
  return { pageW: best.W, pageH: best.H, cols: best.cols, rows: best.rows, landscape: best === b };
}
