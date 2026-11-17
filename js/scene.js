// Shared scene pieces for the editor canvas: the card on its paper, drawn in
// millimetres, with the guide overlays (trim, bleed, ridges, lens sheet…).

import { printableMm, fitsOn, bleedBoxPx } from './core/geometry.js';
import { makeCanvas } from './canvas.js';
import { renderComposite } from './compose.js';

/** Where everything sits, in mm, with the paper's top-left at the origin. */
export function paperLayout(state) {
  const { widthMm: cw, heightMm: ch, bleedMm: b } = state.card;
  const m = state.interlace.marks ? state.interlace.marginMm : 0;
  const totalW = cw + 2 * b + 2 * m, totalH = ch + 2 * b + 2 * m;
  let pw = state.media.widthMm, ph = state.media.heightMm;
  const area = printableMm(state.media);
  const fits = fitsOn(totalW, totalH, area.w, area.h);
  // Turn the paper if the card only fits (or fits better) the other way round.
  const portraitOk = totalW <= area.w && totalH <= area.h;
  if (!portraitOk && (totalW <= area.h && totalH <= area.w || (!fits && cw > ch))) [pw, ph] = [ph, pw];
  const um = state.media.marginMm ?? 3;
  const bleedBox = { x: (pw - cw - 2 * b) / 2, y: (ph - ch - 2 * b) / 2, w: cw + 2 * b, h: ch + 2 * b };
  const trim = { x: bleedBox.x + b, y: bleedBox.y + b, w: cw, h: ch };
  const marks = { x: bleedBox.x - m, y: bleedBox.y - m, w: totalW, h: totalH };
  let lensSheet = null;
  let { sheetWidthMm: sw, sheetHeightMm: sh } = state.lens;
  if (sw > 0 && sh > 0) {
    if ((sw > sh) !== (cw > ch)) [sw, sh] = [sh, sw];
    lensSheet = { x: trim.x + (cw - sw) / 2, y: trim.y + (ch - sh) / 2, w: sw, h: sh, fits: fitsOn(cw, ch, sw, sh) };
  }
  return {
    paper: { x: 0, y: 0, w: pw, h: ph },
    printable: { x: um, y: um, w: pw - 2 * um, h: ph - 2 * um },
    card: bleedBox, trim, marks, marginMm: m, bleedMm: b, lensSheet, fits,
  };
}

export const inflate = (r, d) => ({ x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d });
export const inRect = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

const rect = (ctx, r) => ctx.rect(r.x, r.y, r.w, r.h);

export function drawSheet(ctx, v, r) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.28)';
  ctx.shadowBlur = 14 * v.px * v.k; // shadowBlur is in device px, unaffected by scale
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = '#fff';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.restore();
}

function dashed(ctx, v, r, color, dash = [5, 4], width = 1.25) {
  ctx.save();
  ctx.beginPath();
  rect(ctx, r);
  ctx.setLineDash(dash.map((d) => d * v.px));
  ctx.lineWidth = width * v.px;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.restore();
}

/**
 * Card image cache: composites the layers at roughly screen resolution and
 * re-renders when the project changes or the zoom calls for more pixels.
 */
export function createCardImage(store) {
  let canvas = null, stamp = -1, forW = 0;
  let version = 0;
  return {
    touch() { version++; },
    get(v, cardMm, opts = {}) {
      const { w, h } = bleedBoxPx(store.state.card, store.state.printer.ppi);
      const want = Math.min(w, 2400, Math.max(200, Math.ceil(cardMm.w * v.k * v.dpr)));
      if (!canvas || stamp !== version || want > forW * 1.3 || want < forW / 2.5) {
        canvas = makeCanvas(want, Math.round((want * h) / w));
        renderComposite(canvas, { state: store.state, assets: store.assets, ...opts });
        stamp = version; forW = want;
      }
      return canvas;
    },
  };
}

/**
 * Draw the paper, the card and (when v.guides) its overlays.
 * @param {object} o
 * @param {HTMLCanvasElement|null} o.image  card artwork, stretched to the bleed box
 * @param {boolean} [o.dimPaper]   de-emphasise the paper (image-editing steps)
 * @param {string}  [o.emptyText]  shown on the card when there is no artwork
 */
export function drawCardOnPaper(ctx, v, L, state, { image = null, dimPaper = false, emptyText = '' } = {}) {
  const c = v.colors;
  const g = v.guides;

  drawSheet(ctx, v, L.paper);
  if (g) {
    dashed(ctx, v, L.printable, c.line, [2, 3], 1);
    v.text(`${state.media.name || 'Paper'} · ${fmtMm(L.paper.w)} × ${fmtMm(L.paper.h)} mm`, L.paper.x, L.paper.y, { dy: -8, color: c.muted });
  }

  // Card artwork (or placeholder), clipped to the bleed box.
  ctx.save();
  ctx.beginPath(); rect(ctx, L.card); ctx.clip();
  if (image) {
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, L.card.x, L.card.y, L.card.w, L.card.h);
  } else {
    ctx.fillStyle = '#f1efe9';
    ctx.fillRect(L.card.x, L.card.y, L.card.w, L.card.h);
  }
  ctx.restore();
  if (!image && emptyText) v.text(emptyText, L.card.x + L.card.w / 2, L.card.y + L.card.h / 2, { align: 'center', baseline: 'middle', size: 13 });

  if (dimPaper) {
    // Soften everything outside the bleed box so the artwork leads.
    ctx.save();
    ctx.beginPath(); rect(ctx, inflate(L.paper, 0)); rect(ctx, L.card);
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    ctx.fill('evenodd');
    ctx.restore();
  }

  if (!g) return;

  // Bleed band.
  if (L.bleedMm > 0) {
    ctx.save();
    ctx.beginPath(); rect(ctx, L.card); rect(ctx, L.trim);
    ctx.fillStyle = 'rgba(230,57,70,.13)';
    ctx.fill('evenodd');
    ctx.restore();
  }
  // Marks margin.
  if (L.marginMm > 0) dashed(ctx, v, L.marks, c.muted, [1.5, 3], 1);
  // Trim (cut) line.
  dashed(ctx, v, L.trim, c.trim, [6, 4], 1.5);
  // Lens sheet.
  if (L.lensSheet) dashed(ctx, v, L.lensSheet, L.lensSheet.fits ? c.select : c.err, [10, 4, 2, 4], 1.5);

  // Labels.
  v.text('cut line', L.trim.x, L.trim.y, { dx: 6, dy: 14, color: c.trim, bg: '#fff', bold: true });
  if (L.bleedMm > 0) v.text(`bleed ${fmtMm(L.bleedMm)} mm`, L.card.x + L.card.w, L.card.y, { align: 'right', dx: -4, dy: -5, color: c.trim });
  if (L.marginMm > 0) v.text('marks margin', L.marks.x, L.marks.y + L.marks.h, { dy: 14, color: c.muted });
  if (L.lensSheet) v.text(`lens sheet ${fmtMm(L.lensSheet.w)} × ${fmtMm(L.lensSheet.h)} mm${L.lensSheet.fits ? '' : ' (too small)'}`, L.lensSheet.x + L.lensSheet.w, L.lensSheet.y + L.lensSheet.h, { align: 'right', dy: 14, color: L.lensSheet.fits ? c.select : c.err, bg: '#fff' });
  v.text(`${fmtMm(L.trim.w)} × ${fmtMm(L.trim.h)} mm`, L.trim.x + L.trim.w / 2, L.trim.y + L.trim.h, { align: 'center', dy: -8, color: c.text, bold: true, bg: '#fff' });
  if (!L.fits) v.text('Does not fit the printable area', L.paper.x + L.paper.w / 2, L.paper.y + L.paper.h, { align: 'center', dy: 18, color: c.err, bold: true });
}

/** Faint ridge lines across the card plus a turn / tilt hint. */
export function drawRidges(ctx, v, L, orientation) {
  if (!v.guides) return;
  const vertical = orientation !== 'horizontal';
  const r = L.trim;
  const step = Math.max(2.2, 9 * v.px); // schematic spacing: real ridges are far finer
  ctx.save();
  ctx.beginPath(); rect(ctx, r); ctx.clip();
  ctx.beginPath();
  if (vertical) for (let x = r.x + step / 2; x < r.x + r.w; x += step) { ctx.moveTo(x, r.y); ctx.lineTo(x, r.y + r.h); }
  else for (let y = r.y + step / 2; y < r.y + r.h; y += step) { ctx.moveTo(r.x, y); ctx.lineTo(r.x + r.w, y); }
  ctx.lineWidth = 1 * v.px;
  ctx.strokeStyle = 'rgba(42,111,127,.38)';
  ctx.stroke();
  ctx.restore();

  // Hint arrow inside the card: which way to move it.
  const c = v.colors.primary;
  const cx = r.x + r.w / 2, cy = r.y + r.h * 0.22;
  const a = 7 * v.px, len = Math.min(r.w, r.h, 90 * v.px) * 0.3;
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,.9)';
  ctx.beginPath();
  ctx.arc(cx, cy, len + 9 * v.px, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = c; ctx.lineWidth = 2.5 * v.px; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.translate(cx, cy);
  if (!vertical) ctx.rotate(Math.PI / 2);
  ctx.beginPath();
  ctx.moveTo(-len, 0); ctx.lineTo(len, 0);
  ctx.moveTo(-len + a, -a * 0.7); ctx.lineTo(-len, 0); ctx.lineTo(-len + a, a * 0.7);
  ctx.moveTo(len - a, -a * 0.7); ctx.lineTo(len, 0); ctx.lineTo(len - a, a * 0.7);
  ctx.stroke();
  ctx.restore();
  v.text(vertical ? 'ridges vertical · turn left / right' : 'ridges horizontal · tilt toward / away', cx, cy + len + 9 * v.px, { align: 'center', baseline: 'top', dy: 6, color: c, bold: true, bg: '#fff' });
}

/**
 * Docked lens cross-section: the strips under one lens and which of them are
 * in view. active = frame indices (one for a tilt, two for the eyes).
 */
export function drawLensWidget(ctx, v, { n, active = [], reverse = false, label = '', tags = [] }) {
  const c = v.colors;
  v.screen((x) => {
    const w = 200, hgt = 104, left = 12, top = v.H - hgt - 12;
    x.globalAlpha = 0.94;
    x.fillStyle = c.panel;
    x.strokeStyle = c.line;
    x.beginPath(); x.roundRect(left, top, w, hgt, 8); x.fill(); x.globalAlpha = 1; x.stroke();
    const x0 = left + 16, lw = w - 32, base = top + 62, sw = lw / n;
    // lens
    x.beginPath(); x.moveTo(x0, base); x.quadraticCurveTo(x0 + lw / 2, base - 62, x0 + lw, base); x.closePath();
    x.fillStyle = 'rgba(42,111,127,.14)'; x.fill(); x.strokeStyle = c.primary; x.lineWidth = 1.5; x.stroke();
    // strips in printed order
    x.font = '10px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    for (let p = 0; p < n; p++) {
      const k = reverse ? n - 1 - p : p, on = active.includes(k);
      x.fillStyle = on ? c.primary : c.stage; x.fillRect(x0 + p * sw + 0.5, base, sw - 1, 14);
      if (sw > 11) { x.fillStyle = on ? '#fff' : c.muted; x.fillText(String(k + 1), x0 + (p + 0.5) * sw, base + 7.5); }
    }
    // rays to the viewer
    x.setLineDash([3, 3]); x.strokeStyle = c.warn; x.lineWidth = 1.5;
    active.forEach((k, i) => {
      const p = reverse ? n - 1 - k : k, sx = x0 + (p + 0.5) * sw, apex = x0 + lw / 2;
      const ex = apex + (apex - sx) * 0.9, ey = top + 12;
      x.beginPath(); x.moveTo(sx, base); x.lineTo(ex, ey); x.stroke();
      if (tags[i]) { x.setLineDash([]); x.fillStyle = c.text; x.font = '600 10px system-ui, sans-serif'; x.fillText(tags[i], ex + (i ? 9 : -9), ey + 2); x.setLineDash([3, 3]); }
    });
    x.setLineDash([]);
    x.fillStyle = c.muted; x.font = '11px system-ui, sans-serif'; x.textAlign = 'center';
    x.fillText(label, left + w / 2, top + hgt - 12);
  });
}

export const fmtMm = (n) => (Math.round(n * 10) / 10).toString();
