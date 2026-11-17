// The strip under the canvas: frame thumbnails, a tilt slider and play.

import { h, slider } from './ui.js';
import { visibleFrameAtAngle } from './core/interlace.js';
import { makeCanvas, ctx2d } from './canvas.js';

/**
 * @param {HTMLElement} strip
 * @param {object} o
 * @param {() => HTMLCanvasElement[]} o.frames
 * @param {() => number} o.viewDeg   lens viewing angle
 * @param {() => number} [o.aspect]  width / height to show thumbnails at (frames may be squeezed)
 * @param {() => void} o.onChange    called when the visible frame may have changed
 */
export function mountTiltStrip(strip, { frames, viewDeg, aspect, onChange }) {
  let tilt = 0, playing = false, timer = 0, dir = 1;
  const thumbs = h('div', { class: 'thumbs' });
  const count = () => frames().length;
  const index = () => visibleFrameAtAngle(tilt, viewDeg(), Math.max(1, count()));
  const angleOf = (i) => ((i + 0.5) / Math.max(1, count()) - 0.5) * viewDeg();
  const mark = () => [...thumbs.children].forEach((t, i) => t.classList.toggle('active', i === index()));
  const tiltSlider = slider({
    label: 'Tilt', value: 0, min: -30, max: 30, step: 0.25, format: (v) => `${v.toFixed(1)}°`,
    onInput: (v) => { tilt = v; mark(); onChange(); },
  });
  const setIndex = (i) => { tilt = angleOf(i); tiltSlider.set(+tilt.toFixed(2)); mark(); onChange(); };
  const playBtn = h('button', { type: 'button', class: 'btn small', title: 'Rock the card back and forth' }, '▶ Play');
  const tick = () => {
    const n = count();
    if (n > 1) {
      let i = index() + dir;
      if (i >= n - 1 || i <= 0) { i = Math.max(0, Math.min(n - 1, i)); dir = -dir; }
      setIndex(i);
    }
    timer = setTimeout(tick, 130);
  };
  const setPlaying = (on) => {
    playing = on;
    clearTimeout(timer);
    playBtn.textContent = on ? '❚❚ Pause' : '▶ Play';
    if (on) tick();
  };
  playBtn.addEventListener('click', () => setPlaying(!playing));
  strip.append(playBtn, thumbs, tiltSlider);

  const api = {
    index,
    get tilt() { return tilt; },
    get playing() { return playing; },
    /** True while the user is looking at a tilted or moving view. */
    get active() { return playing || Math.abs(tilt) > 0.01; },
    reset() { setPlaying(false); tilt = 0; tiltSlider.set(0); mark(); onChange(); },
    refresh() {
      const fr = frames();
      strip.hidden = fr.length < 2;
      if (fr.length < 2) setPlaying(false);
      const a = aspect ? aspect() : (fr[0] ? fr[0].width / fr[0].height : 1);
      thumbs.replaceChildren(...fr.map((f, i) => {
        const t = makeCanvas(Math.round(54 * a), 54);
        ctx2d(t).drawImage(f, 0, 0, t.width, t.height);
        t.title = `Frame ${i + 1}`;
        t.addEventListener('click', () => { setPlaying(false); setIndex(i); });
        return t;
      }));
      mark();
    },
    destroy() { clearTimeout(timer); },
  };
  return api;
}
