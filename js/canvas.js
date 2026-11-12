// Canvas helpers (browser only).

import { setPngDpi } from './core/png.js';

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function ctx2d(c, opts) {
  return c.getContext('2d', { willReadFrequently: false, ...opts });
}

export function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas export failed (image too large?).'))), type, quality);
  });
}

export async function canvasToPngWithDpi(canvas, ppi) {
  return setPngDpi(await canvasToBlob(canvas), ppi);
}

export async function loadBitmap(blob) {
  return createImageBitmap(blob);
}

export async function blobToCanvas(blob) {
  const bmp = await createImageBitmap(blob);
  const c = makeCanvas(bmp.width, bmp.height);
  ctx2d(c).drawImage(bmp, 0, 0);
  bmp.close?.();
  return c;
}

/** Draw `src` to cover a w×h box (centre crop). */
export function drawCover(ctx, src, w, h, srcW = src.width, srcH = src.height) {
  const s = Math.max(w / srcW, h / srcH);
  const dw = srcW * s, dh = srcH * s;
  ctx.drawImage(src, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

/** Resize a canvas/bitmap to exactly w×h (stretch). */
export function resized(src, w, h) {
  const c = makeCanvas(w, h);
  const x = ctx2d(c);
  x.imageSmoothingQuality = 'high';
  x.drawImage(src, 0, 0, w, h);
  return c;
}

export function imageDataOf(canvas) {
  return ctx2d(canvas, { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
}

/** Copy into a display canvas with the card's true aspect ratio. */
export function drawFit(target, src, aspect) {
  const ctx = ctx2d(target);
  ctx.clearRect(0, 0, target.width, target.height);
  let w = target.width, h = w / aspect;
  if (h > target.height) { h = target.height; w = h * aspect; }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, (target.width - w) / 2, (target.height - h) / 2, w, h);
}

/** Size a canvas for display at a given aspect within a max box (device-pixel aware). */
export function sizeForDisplay(canvas, aspect, maxW, maxH) {
  let w = maxW, h = w / aspect;
  if (h > maxH) { h = maxH; w = h * aspect; }
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${Math.round(w)}px`;
  canvas.style.height = `${Math.round(h)}px`;
  return { w: canvas.width, h: canvas.height };
}

/** Load a depth map from an image (grayscale by luminance). */
export async function depthMapFromBlob(blob, maxSide = 1024) {
  const bmp = await createImageBitmap(blob);
  const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = makeCanvas(bmp.width * s, bmp.height * s);
  ctx2d(c).drawImage(bmp, 0, 0, c.width, c.height);
  const d = imageDataOf(c).data;
  const data = new Uint8Array(c.width * c.height);
  for (let i = 0; i < data.length; i++) data[i] = Math.round(0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]);
  return { w: c.width, h: c.height, data };
}

export function depthMapToCanvas(map) {
  const c = makeCanvas(map.w, map.h);
  const x = ctx2d(c);
  const img = x.createImageData(map.w, map.h);
  for (let i = 0; i < map.data.length; i++) {
    const v = map.data[i];
    img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  return c;
}
