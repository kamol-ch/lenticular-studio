// Calibration sheets (plan §5 Step 1): pitch test, viewing-angle test, 2-frame flip.

import { mmToPx, frameGeometry, bleedBoxPx } from './core/geometry.js';
import { frameIndexAt } from './core/interlace.js';
import { makeCanvas, ctx2d, canvasToPngWithDpi } from './canvas.js';
import { interlaceCanvases, interlaceParams } from './pipeline.js';

export function pitchCandidates(from, to, step) {
  const out = [];
  if (!(step > 0) || to < from) return out;
  const count = Math.round((to - from) / step);
  for (let i = 0; i <= count && i < 200; i++) out.push(+(from + i * step).toFixed(4));
  return out;
}

/**
 * Bands of black/white lines at candidate LPIs. Looking through the lens, the
 * band that matches the lens shows no beating (stays evenly dark or light as
 * you tilt).
 */
export async function makePitchTest(state) {
  const ppi = state.printer.ppi;
  const { from, to, step } = { from: state.tests.pitchFrom, to: state.tests.pitchTo, step: state.tests.pitchStep };
  const lpis = pitchCandidates(from, to, step);
  if (!lpis.length) throw new Error('Check the pitch range: "from" must be below "to" and step > 0.');
  const vertical = state.lens.orientation !== 'horizontal';
  // Work in a "vertical ridges" frame of reference: W across ridges, H along.
  const cw = Math.round(mmToPx(state.card.widthMm, ppi));
  const ch = Math.round(mmToPx(state.card.heightMm, ppi));
  const W = vertical ? cw : ch;
  const H = vertical ? ch : cw;
  const c = makeCanvas(W, H);
  const x = ctx2d(c);
  x.fillStyle = '#fff';
  x.fillRect(0, 0, W, H);

  const header = Math.round(mmToPx(7, ppi));
  const labelW = Math.round(mmToPx(16, ppi));
  const gap = Math.max(2, Math.round(mmToPx(0.8, ppi)));
  const bandH = Math.floor((H - header) / lpis.length);
  if (bandH < mmToPx(3, ppi)) throw new Error('Too many bands for this card size; narrow the range or raise the step.');

  const fontPx = Math.round(Math.min(bandH * 0.45, mmToPx(3.2, ppi)));
  x.fillStyle = '#000';
  x.font = `600 ${Math.round(mmToPx(3, ppi))}px system-ui, sans-serif`;
  x.textBaseline = 'middle';
  x.fillText(`Pitch test · ${ppi} ppi · print at 100% · lines ${vertical ? 'vertical' : 'horizontal'}`, mmToPx(2, ppi), header / 2);

  const img = x.getImageData(labelW, header, W - labelW, bandH * lpis.length);
  const d = img.data;
  const iw = img.width;
  lpis.forEach((lpi, b) => {
    const pitch = ppi / lpi;
    const rowPattern = new Uint8Array(iw);
    for (let i = 0; i < iw; i++) rowPattern[i] = frameIndexAt(labelW + i, pitch, 2) === 0 ? 0 : 255;
    for (let r = gap; r < bandH; r++) {
      const off = (b * bandH + r) * iw * 4;
      for (let i = 0; i < iw; i++) {
        const v = rowPattern[i], o = off + i * 4;
        d[o] = v; d[o + 1] = v; d[o + 2] = v; d[o + 3] = 255;
      }
    }
  });
  x.putImageData(img, labelW, header);

  x.font = `600 ${fontPx}px ui-monospace, monospace`;
  lpis.forEach((lpi, b) => {
    const y = header + b * bandH + (bandH + gap) / 2;
    x.fillStyle = '#000';
    x.fillText(lpi.toFixed(2), mmToPx(1.5, ppi), y);
  });

  let out = c;
  if (!vertical) {
    out = makeCanvas(H, W);
    const o = ctx2d(out);
    o.translate(H, 0);
    o.rotate(Math.PI / 2);
    o.drawImage(c, 0, 0);
  }
  return canvasToPngWithDpi(out, ppi);
}

const ANGLE_COLORS = ['#d7263d', '#f46036', '#f2c14e', '#2e9e44', '#1b998b', '#2e86de', '#5f4bb6', '#c04abc', '#6d6875', '#222222', '#aaaaaa', '#7a4a2a'];

function testFrames(state, n, draw) {
  const g = frameGeometry(state);
  const { w: outW, h: outH } = bleedBoxPx(state.card, state.printer.ppi);
  return Array.from({ length: n }, (_, i) => {
    const c = makeCanvas(g.fw, g.fh);
    const x = ctx2d(c);
    x.setTransform(g.fw / outW, 0, 0, g.fh / outH, 0, 0);
    draw(x, i, outW, outH);
    return c;
  });
}

/** Each frame a solid colour with its number: tilt to see where the sequence repeats. */
export async function makeAngleTest(state, onProgress) {
  const n = state.plan.frames;
  const frames = testFrames(state, n, (x, i, W, H) => {
    x.fillStyle = ANGLE_COLORS[i % ANGLE_COLORS.length];
    x.fillRect(0, 0, W, H);
    x.fillStyle = '#fff';
    x.font = `700 ${Math.round(Math.min(W, H) * 0.45)}px system-ui, sans-serif`;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(String(i + 1), W / 2, H / 2);
  });
  const r = await interlaceCanvases(frames, interlaceParams(state, { tileA4: false }), onProgress);
  return r.blob;
}

/** Two-frame flip: the simplest print test after pitch is known. */
export async function makeFlipTest(state, onProgress) {
  const frames = testFrames(state, 2, (x, i, W, H) => {
    x.fillStyle = i === 0 ? '#fff' : '#111';
    x.fillRect(0, 0, W, H);
    x.fillStyle = i === 0 ? '#111' : '#fff';
    x.font = `800 ${Math.round(Math.min(W, H) * 0.6)}px system-ui, sans-serif`;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(i === 0 ? 'A' : 'B', W / 2, H / 2);
  });
  const r = await interlaceCanvases(frames, interlaceParams(state, { tileA4: false }), onProgress);
  return r.blob;
}
