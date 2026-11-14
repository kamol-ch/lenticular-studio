import { h, card, row, hint, tip, numberField, selectField, slider, checkbox, button, radios, downloadBlob, pickFiles, toast, clear, progress, warnings } from '../ui.js';
import { bleedBoxPx, mmToPx } from '../core/geometry.js';
import { EFFECT_TYPES, EASINGS, newEffect, maxMotionMmPerFrame } from '../core/motion.js';
import { frameOrder, evenlySpacedTimes, estimateShift, toGray } from '../core/sequence.js';
import { makeCanvas, ctx2d, sizeForDisplay, imageDataOf } from '../canvas.js';
import { renderComposite, MASK_TARGET, invalidateMaskCentre, frameSource } from '../compose.js';
import { exportAnimation, importAnimation } from '../project-io.js';
import { buildFinalFrames } from '../pipeline.js';
import { planFor } from './s2-plan.js';

const EASING_LABELS = { linear: 'Linear', easeInOut: 'Ease in-out', easeIn: 'Ease in', easeOut: 'Ease out', sine: 'Sine' };

function once(el, ev) { return new Promise((res, rej) => { el.addEventListener(ev, res, { once: true }); el.addEventListener('error', () => rej(new Error('Video could not be decoded by this browser.')), { once: true }); }); }

/** Extract n frames from a video file, cover-cropped to the card aspect. */
async function extractClip(file, { start, end, n, pingPong, align, aspect, maxSide = 2048 }, onProgress) {
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

export default {
  id: 4,
  title: 'Animation',
  subtitle: 'Motion or video',
  optional: true,
  intro: 'Optional. Make part of the card move as you tilt it.',
  guide: [
    ['motion', 'Simple motion', 'Bob, drift, sway or fade a layer'],
    ['mask', 'Or paint a mask', 'Move just one part of a scan'],
    ['video', 'Or use a clip', 'A 2–3 s video becomes frames'],
  ],
  details: [
    'Small motions read best through a lens. Moving more than about one lens width between frames causes ghosting; the warning below tells you when.',
    'Animation looks best with horizontal ridges (set in Step 2). Combined with 3D (vertical ridges), keep motion very subtle.',
  ],
  render(root, { store, go }) {
    const s = () => store.state;
    const prog = progress();
    const n = () => s().plan.frames;
    const b = () => bleedBoxPx(s().card, s().printer.ppi);

    // ---------- preview ----------
    const canvas = h('canvas', { 'aria-label': 'Animation preview' });
    const stage = h('div', { class: 'stage' }, canvas);
    let previewFrames = [];
    let playing = true, painting = false, fi = 0, dir = 1, timer = 0;
    const thumbs = h('div', { class: 'thumbs' });

    const displaySize = () => sizeForDisplay(canvas, b().w / b().h, Math.min(520, (stage.clientWidth || 520) - 24), 520);

    const rebuildPreview = () => {
      displaySize();
      const st = s();
      if (st.animation.mode === 'clip') {
        previewFrames = store.assets.animFrames.slice();
      } else {
        previewFrames = Array.from({ length: n() }, (_, i) => renderComposite(makeCanvas(canvas.width, canvas.height), {
          state: st, assets: store.assets, frameIndex: i, n: n(), withMotion: st.animation.mode === 'simple',
        }));
      }
      clear(thumbs);
      previewFrames.forEach((f, i) => {
        const t = makeCanvas(Math.round(72 * f.width / f.height), 72);
        ctx2d(t).drawImage(f, 0, 0, t.width, t.height);
        t.title = `Frame ${i + 1}`;
        t.addEventListener('click', () => { playing = false; fi = i; paint(); playBtn.textContent = 'Play'; });
        thumbs.append(t);
      });
      fi = Math.min(fi, Math.max(0, previewFrames.length - 1));
      paint();
    };

    const tint = (mask) => {
      const t = makeCanvas(canvas.width, canvas.height);
      const x = ctx2d(t);
      x.fillStyle = '#ff2d55';
      x.fillRect(0, 0, t.width, t.height);
      x.globalCompositeOperation = 'destination-in';
      x.drawImage(mask, 0, 0, t.width, t.height);
      return t;
    };

    const paint = () => {
      const x = ctx2d(canvas);
      x.clearRect(0, 0, canvas.width, canvas.height);
      const f = painting ? previewFrames[Math.floor(previewFrames.length / 2)] : previewFrames[fi];
      if (f) x.drawImage(f, 0, 0, canvas.width, canvas.height);
      else { x.fillStyle = '#fff'; x.fillRect(0, 0, canvas.width, canvas.height); }
      if (painting && store.assets.motionMask) {
        x.globalAlpha = 0.45;
        x.drawImage(tint(store.assets.motionMask), 0, 0);
        x.globalAlpha = 1;
      }
      [...thumbs.children].forEach((t, i) => t.classList.toggle('active', i === fi));
    };

    const tick = () => {
      clearTimeout(timer);
      if (playing && !painting && previewFrames.length > 1) {
        fi += dir;
        if (fi >= previewFrames.length - 1 || fi <= 0) { fi = Math.max(0, Math.min(previewFrames.length - 1, fi)); dir = -dir; }
        paint();
      }
      timer = setTimeout(tick, 1000 / (s().animation.previewFps || 8));
    };

    const playBtn = h('button', { type: 'button', class: 'btn small' }, 'Pause');
    playBtn.addEventListener('click', () => { playing = !playing; playBtn.textContent = playing ? 'Pause' : 'Play'; });

    // ---------- mask painting ----------
    let brush = 40, erase = false, strokes = false;
    const ensureMask = () => {
      if (store.assets.motionMask) return store.assets.motionMask;
      const A = b().w / b().h;
      const m = makeCanvas(A >= 1 ? 1024 : 1024 * A, A >= 1 ? 1024 / A : 1024);
      store.setAssets({ motionMask: m });
      return m;
    };
    const dab = (e) => {
      const m = ensureMask();
      const r = canvas.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * m.width, y = ((e.clientY - r.top) / r.height) * m.height;
      const c = ctx2d(m);
      c.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
      c.fillStyle = '#fff';
      c.beginPath();
      c.arc(x, y, (brush / r.width) * m.width, 0, Math.PI * 2);
      c.fill();
      strokes = true;
      paint();
    };
    let down = false;
    canvas.addEventListener('pointerdown', (e) => { if (!painting) return; down = true; canvas.setPointerCapture(e.pointerId); dab(e); });
    canvas.addEventListener('pointermove', (e) => { if (painting && down) dab(e); });
    const up = () => {
      if (!down) return;
      down = false;
      if (strokes) { invalidateMaskCentre(store.assets.motionMask); store.dirty = true; strokes = false; schedule(); }
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);

    const maskTools = h('div', { hidden: true },
      row(
        slider({ label: 'Brush', value: brush, min: 4, max: 120, step: 1, format: (v) => `${v}px`, onInput: (v) => { brush = v; } }),
        checkbox({ label: 'Erase', checked: false, onChange: (v) => { erase = v; } }),
      ),
      h('div', { class: 'btn-row' }, button('Clear mask', () => {
        if (store.assets.motionMask) { ctx2d(store.assets.motionMask).clearRect(0, 0, 1e5, 1e5); invalidateMaskCentre(store.assets.motionMask); }
        schedule();
      }, { kind: 'small' })),
    );
    const paintToggle = checkbox({
      label: 'Paint mask', checked: false,
      hint: 'Brush over the part that should move.',
      onChange: (v) => { painting = v; maskTools.hidden = !v; stage.classList.toggle('crosshair', v); paint(); },
    });

    // ---------- simple effects ----------
    const effectsBox = h('div');
    const motionWarn = h('div');
    const targetOptions = () => [...s().layers.map((l) => [l.id, `Layer: ${l.name}`]), [MASK_TARGET, 'Painted mask']];

    const updateEffect = (id, patch) => {
      store.update((st) => { Object.assign(st.animation.effects.find((e) => e.id === id), patch); });
      schedule();
    };

    const renderEffects = () => {
      clear(effectsBox);
      const effs = s().animation.effects;
      if (!effs.length) effectsBox.append(hint('No effects yet.'));
      for (const e of effs) {
        const T = EFFECT_TYPES[e.type];
        effectsBox.append(h('div', { class: 'effect' },
          h('div', { class: 'effect-head' },
            checkbox({ label: T.label, checked: e.enabled !== false, onChange: (v) => updateEffect(e.id, { enabled: v }) }),
            button('Remove', () => { store.update((st) => { st.animation.effects = st.animation.effects.filter((x) => x.id !== e.id); }); renderEffects(); schedule(); }, { kind: 'small danger' })),
          row(
            selectField({ label: 'Target', value: e.target, options: targetOptions(), onChange: (v) => updateEffect(e.id, { target: v }) }),
            selectField({
              label: 'Effect', value: e.type, options: Object.entries(EFFECT_TYPES).map(([k, v]) => [k, v.label]),
              onChange: (v) => { updateEffect(e.id, { type: v, amount: EFFECT_TYPES[v].defaultAmount }); renderEffects(); },
            }),
          ),
          row(
            numberField({ label: 'Amount', unit: T.unit, value: e.amount, step: 0.1, onChange: (v) => v != null && updateEffect(e.id, { amount: v }) }),
            T.hasDirection ? numberField({ label: 'Direction', unit: '°', hint: '0 → right, 90 → down', value: e.angleDeg, step: 15, onChange: (v) => v != null && updateEffect(e.id, { angleDeg: v }) }) : null,
            T.hasCycles ? numberField({ label: 'Cycles', value: e.cycles, step: 0.5, min: 0.5, onChange: (v) => v > 0 && updateEffect(e.id, { cycles: v }) }) : null,
            selectField({ label: 'Easing', value: e.easing, options: Object.keys(EASINGS).map((k) => [k, EASING_LABELS[k]]), onChange: (v) => updateEffect(e.id, { easing: v }) }),
          ),
        ));
      }
    };

    const refreshWarn = () => {
      const p = planFor(s());
      const ws = p.warnings.filter((w) => w.code === 'ghosting-risk');
      if (s().animation.mode === 'simple') {
        const mm = maxMotionMmPerFrame(s().animation.effects.filter((e) => e.enabled !== false), n());
        ws.unshift({ level: 'info', text: `Largest move between frames: ${mmToPx(mm, s().printer.ppi).toFixed(1)} px (budget ${p.maxShiftPxPerFrame.toFixed(1)} px). Small motions read best through a lens.` });
      }
      if (s().animation.mode !== 'none' && s().orientation === 'vertical' && s().effect === 'animation') {
        ws.push({ level: 'warn', text: 'Animation usually needs horizontal ridges so both eyes see the same frame. Change the ridge direction in Step 2.' });
      }
      motionWarn.replaceChildren(warnings(ws) || '');
    };

    const simplePanel = card('Simple motion',
      effectsBox,
      h('div', { class: 'btn-row' },
        button('+ Add effect', () => {
          const target = s().layers.at(-1)?.id || MASK_TARGET;
          store.update((st) => { st.animation.effects.push(newEffect('bob', target)); });
          renderEffects(); schedule();
        })),
      h('h4', {}, 'Mask'),
      paintToggle, maskTools,
      motionWarn,
    );

    // ---------- clip ----------
    const video = h('video', { controls: true, muted: true, playsinline: true, style: { width: '100%', maxHeight: '260px', background: '#000', borderRadius: '8px' } });
    const clipInfo = h('p', { class: 'hint' }, store.assets.clipFile ? store.assets.clipFile.name : (s().animation.clip.fileName ? `Last clip: ${s().animation.clip.fileName} (re-select to extract again)` : 'No clip selected.'));
    const loadVideo = (f) => {
      store.setAssets({ clipFile: f });
      video.src = URL.createObjectURL(f);
      clipInfo.textContent = f.name;
      store.update((st) => { st.animation.clip.fileName = f.name; });
    };
    if (store.assets.clipFile) video.src = URL.createObjectURL(store.assets.clipFile);
    const startF = numberField({ label: 'Start', unit: 's', value: s().animation.clip.start, step: 0.05, min: 0, onChange: (v) => store.update((st) => { st.animation.clip.start = v ?? 0; }) });
    const endF = numberField({ label: 'End', unit: 's', value: s().animation.clip.end, step: 0.05, min: 0, onChange: (v) => store.update((st) => { st.animation.clip.end = v ?? 0; }) });
    const setFromVideo = (which, field) => button(`Set ${which} = now`, () => {
      const t = +video.currentTime.toFixed(2);
      field.querySelector('input').value = t;
      store.update((st) => { st.animation.clip[which] = t; });
    }, { kind: 'small' });

    const clipPanel = card('From video clip',
      tip('Pick a 2–3 s stretch of gentle motion.', 'Make the clip in any video tool. Set start and end while scrubbing the video, then extract. Ping-pong plays the clip forward then back, so tilting either way looks seamless.'),
      h('div', { class: 'btn-row' }, button('Choose video…', async () => { const [f] = await pickFiles({ accept: 'video/*' }); if (f) loadVideo(f); }), clipInfo),
      video,
      row(startF, endF),
      h('div', { class: 'btn-row' }, setFromVideo('start', startF), setFromVideo('end', endF)),
      checkbox({ label: 'Ping-pong loop', checked: s().animation.clip.pingPong, onChange: (v) => store.update((st) => { st.animation.clip.pingPong = v; }) }),
      checkbox({ label: 'Align to first frame', checked: s().animation.clip.align, onChange: (v) => store.update((st) => { st.animation.clip.align = v; }) }),
      h('div', { class: 'btn-row' }, button(`Extract ${n()} frames`, async () => {
        const f = store.assets.clipFile;
        if (!f) throw new Error('Choose a video first.');
        const c = s().animation.clip;
        if (!(c.end > c.start)) throw new Error('End must be after start.');
        const { frames } = await extractClip(f, { start: c.start, end: c.end, n: n(), pingPong: c.pingPong, align: c.align, aspect: b().w / b().h }, (p, l) => prog.set(p, l));
        prog.done();
        store.setAssets({ animFrames: frames });
        store.setStep(4, 'done');
        rebuildPreview();
        toast(`Extracted ${frames.length} frames.`);
      }, { kind: 'primary' })),
    );

    // ---------- mode ----------
    const panels = h('div');
    const showPanels = () => {
      const m = s().animation.mode;
      panels.replaceChildren(m === 'simple' ? simplePanel : m === 'clip' ? clipPanel : card(null, hint('No animation: every frame shows the same image (plus 3D, if set up in Step 5).')));
      refreshWarn();
    };

    let debounce = 0;
    const schedule = () => { clearTimeout(debounce); debounce = setTimeout(() => { rebuildPreview(); refreshWarn(); }, 120); };

    root.append(
      card('Mode', radios({
        name: 'anim-mode', value: s().animation.mode,
        options: [['none', 'None'], ['simple', 'Simple motion'], ['clip', 'Video clip']],
        onChange: (v) => { store.update((st) => { st.animation.mode = v; }); showPanels(); schedule(); },
      })),
      prog,
      h('div', { class: 'cols-wide' },
        panels,
        card('Preview',
          stage,
          h('div', { class: 'btn-row', style: { marginTop: '10px' } }, playBtn,
            slider({ label: 'Speed', value: s().animation.previewFps, min: 2, max: 24, step: 1, format: (v) => `${v} fps`, onChange: (v) => store.update((st) => { st.animation.previewFps = v; }) })),
          thumbs,
          hint('Bounces back and forth, like tilting the card.'),
        ),
      ),
      card('Next',
        h('div', { class: 'btn-row' },
          button('Use as final frames', async () => {
            if (!frameSource(s(), store.assets)) throw new Error('Nothing to build yet.');
            await buildFinalFrames((p, l) => prog.set(p, l));
            prog.done();
            store.setStep(4, 'done');
            toast('Final frames built.');
            go(s().depth.mode === 'none' ? 6 : 5);
          }, { kind: 'primary' }),
          hint('Want 3D too? Continue to Step 5.'),
        ),
        h('h4', {}, 'Import / export'),
        h('div', { class: 'btn-row' },
          button('Export animation.zip', async () => {
            let frames;
            if (s().animation.mode === 'clip') frames = store.assets.animFrames;
            else {
              const { w, h: hh } = b();
              const k = Math.min(1, 2048 / Math.max(w, hh));
              frames = Array.from({ length: n() }, (_, i) => renderComposite(makeCanvas(w * k, hh * k), { state: s(), assets: store.assets, frameIndex: i, n: n(), withMotion: s().animation.mode === 'simple' }));
            }
            if (!frames.length) throw new Error('No frames to export.');
            downloadBlob(await exportAnimation(frames), 'animation.zip');
          }),
          button('Import animation.zip…', async () => {
            const [f] = await pickFiles({ accept: '.zip' });
            if (!f) return;
            await importAnimation(f);
            showPanels(); rebuildPreview();
            toast(`Imported ${store.assets.animFrames.length} animation frames.`);
          }, { kind: 'ghost' }),
        ),
      ),
    );
    showPanels();
    renderEffects();
    rebuildPreview();
    tick();
    const ro = new ResizeObserver(() => { const w = canvas.width; displaySize(); if (canvas.width !== w) rebuildPreview(); });
    ro.observe(stage);
    return () => { clearTimeout(timer); clearTimeout(debounce); ro.disconnect(); };
  },
};
