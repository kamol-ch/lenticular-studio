// Video clip → frames (plan §5 Step 4a): seek, cover-crop to the card, optional drift alignment.

import { h } from './ui.js';
import { frameOrder, evenlySpacedTimes, estimateShift, toGray } from './core/sequence.js';
import { makeCanvas, ctx2d, imageDataOf } from './canvas.js';

function once(el, ev) { return new Promise((res, rej) => { el.addEventListener(ev, res, { once: true }); el.addEventListener('error', () => rej(new Error('Video could not be decoded by this browser.')), { once: true }); }); }

/** Extract n frames from a video file, cover-cropped to the card aspect. */
export async function extractClip(file, { start, end, n, pingPong, align, aspect, maxSide = 2048 }, onProgress) {
  const url = URL.createObjectURL(file);
  const video = h('video', { muted: true, playsinline: true, preload: 'auto' });
  video.muted = true;
  video.src = url;
  try {
    await once(video, 'loadeddata');
    const dur = video.duration;
    const t0 = Math.max(0, Math.min(start, dur)), t1 = Math.max(t0, Math.min(end, dur - 0.01));
    const { extract, order } = frameOrder(n, pingPong);
    const times = evenlySpacedTimes(t0, t1, extract);
    const vw = video.videoWidth, vh = video.videoHeight;
    // Crop the largest card-aspect window from the video.
    let cw = vw, ch = vw / aspect;
    if (ch > vh) { ch = vh; cw = vh * aspect; }
    const outScale = Math.min(1, maxSide / Math.max(cw, ch));
    const W = Math.round(cw * outScale), H = Math.round(ch * outScale);

    const raw = [];
    for (let i = 0; i < times.length; i++) {
      video.currentTime = times[i];
      await once(video, 'seeked');
      const c = makeCanvas(W, H);
      ctx2d(c).drawImage(video, (vw - cw) / 2, (vh - ch) / 2, cw, ch, 0, 0, W, H);
      raw.push(c);
      onProgress((i + 1) / times.length * (align ? 0.7 : 1), `Frame ${i + 1}/${times.length}`);
    }

    let frames = raw;
    if (align && raw.length > 1) {
      const sw = 192, sh = Math.round(192 / aspect);
      const gray = raw.map((c) => {
        const s = makeCanvas(sw, sh);
        ctx2d(s).drawImage(c, 0, 0, sw, sh);
        return toGray(imageDataOf(s).data, sw, sh);
      });
      const shifts = raw.map((_, i) => (i === 0 ? { dx: 0, dy: 0 } : estimateShift(gray[0], gray[i], sw, sh, 8, 2)))
        .map(({ dx, dy }) => ({ dx: dx * (W / sw), dy: dy * (H / sh) }));
      // One zoom for every frame (so nothing pulses) that hides the revealed edges.
      const z = 1 + 2 * Math.max(...shifts.map((t) => Math.max(Math.abs(t.dx) / W, Math.abs(t.dy) / H)));
      frames = raw.map((c, i) => {
        const out = makeCanvas(W, H);
        const x = ctx2d(out);
        x.imageSmoothingQuality = 'high';
        x.drawImage(c, (W - W * z) / 2 + shifts[i].dx * z, (H - H * z) / 2 + shifts[i].dy * z, W * z, H * z);
        onProgress(0.7 + 0.3 * ((i + 1) / raw.length), 'Aligning');
        return out;
      });
    }
    return { frames: order.map((i) => frames[i]), duration: dur };
  } finally {
    URL.revokeObjectURL(url);
  }
}
