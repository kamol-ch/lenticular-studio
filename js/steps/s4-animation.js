import { h, row, hint, tip, section, numberField, selectField, slider, checkbox, button, radios, downloadBlob, pickFiles, toast, clear, progress, warnings } from '../ui.js';
import { bleedBoxPx, mmToPx } from '../core/geometry.js';
import { EFFECT_TYPES, EASINGS, newEffect, maxMotionMmPerFrame } from '../core/motion.js';
import { makeCanvas, ctx2d } from '../canvas.js';
import { renderComposite, MASK_TARGET, invalidateMaskCentre, frameSource } from '../compose.js';
import { exportAnimation, importAnimation } from '../project-io.js';
import { extractClip } from '../clip-tools.js';
import { paperLayout, drawCardOnPaper, drawLensWidget, inflate, inRect } from '../scene.js';
import { createLivePreview } from '../preview.js';
import { mountTiltStrip } from '../tiltstrip.js';
import { planFor } from './s2-plan.js';

const EASING_LABELS = { linear: 'Linear', easeInOut: 'Ease in-out', easeIn: 'Ease in', easeOut: 'Ease out', sine: 'Sine' };

export default {
  id: 4,
  title: 'Animation',
  subtitle: 'Motion or video',
  optional: true,
  intro: 'Optional. Make part of the card move as you tilt it. Press Play to watch.',
  details: [
    'Simple motion moves a whole layer, or the area you paint with the mask brush (for a single flat scan).',
    'Small motions read best through a lens. Moving more than about one lens width between frames causes ghosting; a warning appears when that happens.',
    'Animation looks best with horizontal ridges (set in Step 2). Combined with 3D (vertical ridges), keep motion very subtle.',
    'A video clip replaces the layers: 2–3 seconds of gentle motion works best.',
  ],
  editor({ store, stage, inspector, tools, strip }) {
    const s = () => store.state;
    const n = () => s().plan.frames;
    const prog = progress();
    let L = paperLayout(s());
    const preview = createLivePreview(store);
    let painting = false, erase = false, brushPct = 6, hoverPt = null;

    const ts = mountTiltStrip(strip, {
      frames: () => (s().animation.mode === 'none' && s().depth.mode === 'none' ? [] : preview.frames()),
      viewDeg: () => planFor(s()).viewingAngleDeg,
      onChange: () => stage.invalidate(),
    });

    // ---------- mask ----------
    let tintCanvas = null;
    const ensureMask = () => {
      if (store.assets.motionMask) return store.assets.motionMask;
      const b = bleedBoxPx(s().card, s().printer.ppi), k = 1024 / Math.max(b.w, b.h);
      const m = makeCanvas(b.w * k, b.h * k);
      store.setAssets({ motionMask: m });
      return m;
    };
    const tint = () => {
      const m = store.assets.motionMask;
      if (!m) return null;
      if (!tintCanvas) {
        tintCanvas = makeCanvas(m.width, m.height);
        const x = ctx2d(tintCanvas);
        x.fillStyle = '#ff2d55';
        x.fillRect(0, 0, m.width, m.height);
        x.globalCompositeOperation = 'destination-in';
        x.drawImage(m, 0, 0);
      }
      return tintCanvas;
    };
    const brushMm = () => (brushPct / 100) * L.card.w;

    stage.setScene({
      bounds: () => inflate(L.card, 12),
      draw(ctx, v) {
        const fr = preview.frames();
        const image = painting ? fr[Math.floor(fr.length / 2)] : (fr[ts.index()] || fr[0]);
        drawCardOnPaper(ctx, v, L, s(), { image: image || null, dimPaper: true, emptyText: 'Add an image in Step 3, or choose a video clip' });
        if (painting && tint()) {
          ctx.save();
          ctx.globalAlpha = 0.45;
          ctx.drawImage(tint(), L.card.x, L.card.y, L.card.w, L.card.h);
          ctx.restore();
        }
        if (painting && hoverPt && inRect(hoverPt, L.card)) {
          ctx.save();
          ctx.beginPath(); ctx.arc(hoverPt.x, hoverPt.y, brushMm(), 0, Math.PI * 2);
          ctx.lineWidth = 2.5 * v.px; ctx.strokeStyle = '#000'; ctx.stroke();
          ctx.lineWidth = 1 * v.px; ctx.strokeStyle = '#fff'; ctx.stroke();
          ctx.restore();
        }
        if (v.guides) {
          if (painting) v.text('pink = the part that moves', L.card.x + L.card.w / 2, L.card.y + L.card.h, { align: 'center', dy: 16, bold: true, color: v.colors.text });
          if (fr.length > 1 && !painting && s().animation.mode !== 'none') drawLensWidget(ctx, v, { n: fr.length, active: [ts.index()], label: `Frame ${ts.index() + 1} of ${fr.length}` });
        }
      },
      hover(pt) { hoverPt = pt; if (painting) { stage.invalidate(); return inRect(pt, L.card) ? 'crosshair' : 'grab'; } return 'grab'; },
      pointerDown(pt) {
        if (!painting || !inRect(pt, L.card)) return null;
        const m = ensureMask();
        const dab = (p) => {
          hoverPt = p;
          const c = ctx2d(m);
          c.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
          c.fillStyle = '#fff';
          c.beginPath();
          c.arc(((p.x - L.card.x) / L.card.w) * m.width, ((p.y - L.card.y) / L.card.h) * m.height, (brushMm() / L.card.w) * m.width, 0, Math.PI * 2);
          c.fill();
          tintCanvas = null;
        };
        dab(pt);
        return { move: dab, up: () => { invalidateMaskCentre(m); store.touchAssets(); } };
      },
    });

    // ---------- toolbar (mask brush) ----------
    const paintBtn = h('button', { type: 'button', class: 'btn small toggle', title: 'Paint the part of the picture that should move' }, 'Paint mask');
    const brushTools = h('div', { class: 'stage-tools', hidden: true },
      slider({ label: 'Size', value: brushPct, min: 1, max: 25, step: 1, format: (v) => `${v}%`, onInput: (v) => { brushPct = v; } }),
      checkbox({ label: 'Erase', checked: false, onChange: (v) => { erase = v; } }),
      button('Clear', () => {
        const m = store.assets.motionMask;
        if (m) { ctx2d(m).clearRect(0, 0, m.width, m.height); tintCanvas = null; invalidateMaskCentre(m); store.touchAssets(); }
      }, { kind: 'small ghost' }));
    const setPainting = (on) => {
      painting = on;
      if (on) ts.reset();
      paintBtn.classList.toggle('on', on);
      paintBtn.setAttribute('aria-pressed', on);
      brushTools.hidden = !on;
      stage.invalidate();
    };
    paintBtn.addEventListener('click', () => setPainting(!painting));
    const maskTools = h('div', { class: 'stage-tools' }, paintBtn, brushTools);
    tools.append(maskTools);

    // ---------- simple effects ----------
    const effectsBox = h('div');
    const motionWarn = h('div', { style: { marginTop: '8px' } });
    const targetOptions = () => [...s().layers.map((l) => [l.id, `Layer: ${l.name}`]), [MASK_TARGET, 'Painted mask']];
    const updateEffect = (id, patch) => store.update((st) => { Object.assign(st.animation.effects.find((e) => e.id === id), patch); });

    const renderEffects = () => {
      clear(effectsBox);
      const effs = s().animation.effects;
      if (!effs.length) effectsBox.append(hint('No effects yet. Add one, then press Play under the canvas.'));
      for (const e of effs) {
        const T = EFFECT_TYPES[e.type];
        effectsBox.append(h('div', { class: 'effect' },
          h('div', { class: 'effect-head' },
            checkbox({ label: T.label, checked: e.enabled !== false, onChange: (v) => updateEffect(e.id, { enabled: v }) }),
            button('Remove', () => { store.update((st) => { st.animation.effects = st.animation.effects.filter((x) => x.id !== e.id); }); renderEffects(); }, { kind: 'small danger' })),
          selectField({ label: 'Applies to', value: e.target, options: targetOptions(), onChange: (v) => { updateEffect(e.id, { target: v }); if (v === MASK_TARGET && !store.assets.motionMask) setPainting(true); } }),
          row(
            selectField({
              label: 'Effect', value: e.type, options: Object.entries(EFFECT_TYPES).map(([k, v]) => [k, v.label]),
              onChange: (v) => { updateEffect(e.id, { type: v, amount: EFFECT_TYPES[v].defaultAmount }); renderEffects(); },
            }),
            numberField({ label: 'Amount', unit: T.unit, value: e.amount, step: 0.1, onChange: (v) => v != null && updateEffect(e.id, { amount: v }) }),
          ),
          row(
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
      if (s().animation.mode === 'simple' && s().animation.effects.length) {
        const mm = maxMotionMmPerFrame(s().animation.effects.filter((e) => e.enabled !== false), n());
        ws.unshift({ level: 'info', text: `Largest move between frames: ${mmToPx(mm, s().printer.ppi).toFixed(1)} px (budget ${p.maxShiftPxPerFrame.toFixed(1)} px).` });
      }
      if (s().animation.mode !== 'none' && s().orientation === 'vertical' && s().effect === 'animation') {
        ws.push({ level: 'warn', text: 'Animation usually needs horizontal ridges so both eyes see the same frame. Change the ridge direction in Step 2.' });
      }
      motionWarn.replaceChildren(warnings(ws) || '');
    };

    const effectsSec = section('Motion effects', effectsBox,
      h('div', { class: 'btn-row' }, button('+ Add effect', () => {
        const target = s().layers.at(-1)?.id || MASK_TARGET;
        store.update((st) => { st.animation.effects.push(newEffect('bob', target)); });
        renderEffects();
      }, { kind: 'small primary' })),
      motionWarn,
      tip('To move one part of a flat scan, use Paint mask in the toolbar.', 'Brush over the part that should move (for example a flower head), then set an effect to apply to "Painted mask". The area it leaves behind is filled with a soft blur of its surroundings, so keep mask motion small.'));

    // ---------- clip ----------
    const video = h('video', { controls: true, muted: true, playsinline: true, style: { width: '100%', maxHeight: '200px', background: '#000', borderRadius: '8px' } });
    const clipInfo = h('p', { class: 'hint' }, store.assets.clipFile ? store.assets.clipFile.name : (s().animation.clip.fileName ? `Last clip: ${s().animation.clip.fileName} (choose it again to re-extract)` : 'No clip chosen.'));
    const loadVideo = (f) => {
      store.setAssets({ clipFile: f });
      video.src = URL.createObjectURL(f);
      clipInfo.textContent = f.name;
      store.update((st) => { st.animation.clip.fileName = f.name; });
    };
    if (store.assets.clipFile) video.src = URL.createObjectURL(store.assets.clipFile);
    const startF = numberField({ label: 'Start', unit: 's', value: s().animation.clip.start, step: 0.05, min: 0, onChange: (v) => store.update((st) => { st.animation.clip.start = v ?? 0; }) });
    const endF = numberField({ label: 'End', unit: 's', value: s().animation.clip.end, step: 0.05, min: 0, onChange: (v) => store.update((st) => { st.animation.clip.end = v ?? 0; }) });
    const setFromVideo = (which, field) => button(`${which === 'start' ? 'Start' : 'End'} = now`, () => {
      const t = +video.currentTime.toFixed(2);
      field.querySelector('input').value = t;
      store.update((st) => { st.animation.clip[which] = t; });
    }, { kind: 'small' });
    const clipSec = section('Video clip',
      h('div', { class: 'btn-row' }, button('Choose video…', async () => { const [f] = await pickFiles({ accept: 'video/*' }); if (f) loadVideo(f); }, { kind: 'small' })),
      clipInfo, video,
      row(startF, endF),
      h('div', { class: 'btn-row' }, setFromVideo('start', startF), setFromVideo('end', endF)),
      checkbox({ label: 'Ping-pong loop', checked: s().animation.clip.pingPong, onChange: (v) => store.update((st) => { st.animation.clip.pingPong = v; }) }),
      checkbox({ label: 'Align to first frame', checked: s().animation.clip.align, onChange: (v) => store.update((st) => { st.animation.clip.align = v; }) }),
      h('div', { class: 'btn-row' }, button('Extract frames', async () => {
        const f = store.assets.clipFile;
        if (!f) throw new Error('Choose a video first.');
        const c = s().animation.clip;
        if (!(c.end > c.start)) throw new Error('End must be after start.');
        const b = bleedBoxPx(s().card, s().printer.ppi);
        const { frames } = await extractClip(f, { start: c.start, end: c.end, n: n(), pingPong: c.pingPong, align: c.align, aspect: b.w / b.h }, (p, l) => prog.set(p, l));
        prog.done();
        store.setAssets({ animFrames: frames });
        store.setStep(4, 'done');
        toast(`Extracted ${frames.length} frames. Press Play to watch.`);
      }, { kind: 'primary' })),
      prog,
      tip('Scrub the video, set start and end, then extract.', 'Ping-pong plays the clip forward then back, so tilting either way looks seamless. Align removes small camera drift (translation only).'));

    const showSections = () => {
      const m = s().animation.mode;
      effectsSec.hidden = m !== 'simple';
      clipSec.hidden = m !== 'clip';
      maskTools.hidden = m !== 'simple';
      if (m !== 'simple' && painting) setPainting(false);
    };

    inspector.append(
      section('Mode', radios({
        name: 'anim-mode', value: s().animation.mode,
        options: [['none', 'None'], ['simple', 'Simple motion'], ['clip', 'Video clip']],
        onChange: (v) => { store.update((st) => { st.animation.mode = v; }); showSections(); },
      })),
      effectsSec, clipSec,
      section('Import / export',
        h('div', { class: 'btn-row' },
          button('Export animation.zip', async () => {
            let frames;
            if (s().animation.mode === 'clip') frames = store.assets.animFrames;
            else {
              const b = bleedBoxPx(s().card, s().printer.ppi), k = Math.min(1, 2048 / Math.max(b.w, b.h));
              frames = Array.from({ length: n() }, (_, i) => renderComposite(makeCanvas(b.w * k, b.h * k), { state: s(), assets: store.assets, frameIndex: i, n: n(), withMotion: s().animation.mode === 'simple' }));
            }
            if (!frames.length || !frameSource(s(), store.assets)) throw new Error('No frames to export.');
            downloadBlob(await exportAnimation(frames), 'animation.zip');
          }, { kind: 'small' }),
          button('Import animation.zip…', async () => {
            const [f] = await pickFiles({ accept: '.zip' });
            if (!f) return;
            await importAnimation(f);
            showSections();
            toast(`Imported ${store.assets.animFrames.length} animation frames.`);
          }, { kind: 'small ghost' })),
        { closed: true }),
    );
    showSections(); renderEffects(); refreshWarn();
    ts.refresh();

    let timer = 0;
    const refresh = () => {
      L = paperLayout(s());
      refreshWarn();
      stage.invalidate();
      clearTimeout(timer);
      timer = setTimeout(() => ts.refresh(), 250);
    };
    const offs = [store.on('change', refresh), store.on('assets', () => { tintCanvas = null; refresh(); })];
    return () => { offs.forEach((f) => f()); ts.destroy(); clearTimeout(timer); };
  },
};
