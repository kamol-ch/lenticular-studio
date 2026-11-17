// Size-check marks for test sheets: a border at the exact sheet edge and a
// scale bar of known length. Pure, DOM-free; rectangles are in page pixels.

import { mmToPx } from './geometry.js';

export const SCALE_BAR_MM = 50;

/**
 * @param {object} o
 * @param {number} o.pageW page width (px)
 * @param {number} o.pageH page height (px)
 * @param {number} o.ppi
 * @param {number} o.barX  left end of the scale bar (px)
 * @param {number} o.barY  vertical centre of the scale bar (px)
 * @returns {{rects:{x:number,y:number,w:number,h:number,v:number}[], barPx:number, lineW:number, halo:{x:number,y:number,w:number,h:number}}}
 *   v = grey value (0 black, 255 white), drawn in order.
 */
export function scaleMarks({ pageW, pageH, ppi, barX, barY, barMm = SCALE_BAR_MM }) {
  const lw = Math.max(2, Math.round(mmToPx(0.3, ppi)));     // border and tick width
  const barPx = Math.round(mmToPx(barMm, ppi));              // outer length of the bar
  const bh = Math.max(2, Math.round(mmToPx(0.6, ppi)));     // bar thickness
  const th = Math.round(mmToPx(3, ppi));                     // tick height
  const pad = Math.round(mmToPx(1, ppi));                    // white halo around the bar
  barX = Math.round(barX);
  const top = Math.round(barY - th / 2);
  const halo = { x: barX - pad, y: top - pad, w: barPx + 2 * pad, h: th + 2 * pad };
  const rects = [
    { ...halo, v: 255 },
    { x: barX, y: Math.round(barY - bh / 2), w: barPx, h: bh, v: 0 },
    { x: barX, y: top, w: lw, h: th, v: 0 },
    { x: barX + barPx - lw, y: top, w: lw, h: th, v: 0 },
    // border: its outer edge is the sheet edge
    { x: 0, y: 0, w: pageW, h: lw, v: 0 },
    { x: 0, y: pageH - lw, w: pageW, h: lw, v: 0 },
    { x: 0, y: 0, w: lw, h: pageH, v: 0 },
    { x: pageW - lw, y: 0, w: lw, h: pageH, v: 0 },
  ];
  return { rects, barPx, lineW: lw, halo };
}
