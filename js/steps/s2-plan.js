import { h, card, row, hint, tip, more, guide, pic, numberField, selectField, button, downloadJson, pickFiles, readJsonFile, toast, stat, fmt, warnings } from '../ui.js';
import { lpiInUse, frameGeometry, orientationForEffect, printableMm, fitsOn } from '../core/geometry.js';
import { computePlan } from '../core/planner.js';
import { maxMotionMmPerFrame } from '../core/motion.js';
import { mmToPx } from '../core/geometry.js';
import { SLICES, applySlice } from '../core/schema.js';

export function planFor(state) {
  const motionMm = state.animation.mode === 'simple' ? maxMotionMmPerFrame(state.animation.effects.filter((e) => e.enabled !== false), state.plan.frames) : 0;
  return computePlan({
    ppi: state.printer.ppi,
    lpi: lpiInUse(state.lens),
    frames: state.plan.frames,
    viewingAngleDeg: state.lens.angleDeg,
    card: state.card,
    effect: state.effect,
    ipdMm: state.plan.ipdMm,
    viewDistMm: state.plan.viewDistMm,
    budgetLensPerFrame: state.plan.budgetLensPerFrame,
    depth: { ...state.depth, layers: state.layers },
    motionPxPerFrame: mmToPx(motionMm, state.printer.ppi),
  });
}

const CARD_PRESETS = [
  ['', 'Custom…'],
  ['54x85.6', 'Credit card 54 × 85.6 mm'],
  ['63x88', 'Trading card 63 × 88 mm'],
  ['100x150', '10 × 15 cm (4 × 6 in)'],
  ['105x148', 'A6 105 × 148 mm'],
  ['127x178', '5 × 7 in'],
];

const EFFECTS = [['3d', '3D depth'], ['animation', 'Animation (flip / motion)'], ['3d-motion', '3D + subtle motion']];
const RIDGES = [['vertical', 'Vertical ridges: turn left/right'], ['horizontal', 'Horizontal ridges: tilt toward/away']];

/** Card-level checks against the calibrated lens sheet and paper. */
function cardWarnings(st) {
  const ws = [];
  const { widthMm: w, heightMm: hh, bleedMm: b } = st.card;
  const sw = st.lens.sheetWidthMm, sh = st.lens.sheetHeightMm;
  if (sw > 0 && sh > 0 && !fitsOn(w, hh, sw, sh)) ws.push({ level: 'warn', text: `The card (${w} × ${hh} mm) is larger than the lens sheet (${sw} × ${sh} mm).` });
  const m = st.interlace.marks ? st.interlace.marginMm : 0;
  const area = printableMm(st.media);
  if (!fitsOn(w + 2 * b + 2 * m, hh + 2 * b + 2 * m, area.w, area.h)) {
    ws.push({ level: 'error', text: `With bleed and marks the print is ${fmt.n(w + 2 * b + 2 * m, 1)} × ${fmt.n(hh + 2 * b + 2 * m, 1)} mm, which does not fit the printable area of ${st.media.name || 'the paper'} (${fmt.n(area.w, 1)} × ${fmt.n(area.h, 1)} mm).` });
  }
  const expected = orientationForEffect(st.effect);
  if (st.orientation !== expected) {
    ws.push({ level: 'warn', text: st.effect === 'animation'
      ? 'Animation with vertical ridges: each eye may see a different frame, which reads as ghosting. Horizontal ridges are usual.'
      : '3D needs vertical ridges so each eye sees a different view; with horizontal ridges there is no depth.' });
  }
  return ws;
}

export default {
  id: 2,
  title: 'Card & frame plan',
  subtitle: 'Effect, size, frames',
  intro: 'Choose the effect and card size; the plan shows what the lens can carry.',
  details: [
    '3D needs vertical ridges, so your two eyes look through different strips and see different views. Animation uses horizontal ridges, so both eyes see the same frame and it changes as you tilt the card toward you.',
    'Frames between the eyes: how many frames apart your two eyes are at viewing distance. Under 1.5 the 3D looks weak.',
    'Depth budget: neighbouring frames should differ by about one lens width at most. More than that and the image blurs or ghosts.',
  ],
  render(root, { store, rerender }) {
    const s = () => store.state;
    const set = (fn) => store.update(fn);
    const stats = h('div', { class: 'stats' });
    const warn = h('div');
    const cardWarn = h('div');

    // ---------- effect & ridges ----------
    const ridgeSel = selectField({
      label: 'Ridge direction', value: s().orientation, options: RIDGES,
      onChange: (v) => set((st) => { st.orientation = v; }),
    });
    const effectArt = h('div');
    const renderEffectArt = () => effectArt.replaceChildren({
      '3d': pic('effect3d', '3D', 'Each eye sees a different view'),
      animation: pic('effectAnim', 'Animation', 'Tilt the card to play it'),
      '3d-motion': guide([['effect3d', '3D', 'Each eye, another view'], ['effectAnim', '+ motion', 'Subtle, on tilt']]),
    }[s().effect]);
    renderEffectArt();
    const effectSel = selectField({
      label: 'Effect', value: s().effect, options: EFFECTS,
      onChange: (v) => {
        set((st) => { st.effect = v; st.orientation = orientationForEffect(v); });
        ridgeSel.querySelector('select').value = s().orientation;
        renderEffectArt();
      },
    });

    // ---------- card size ----------
    const sizeFields = h('div');
    const renderSize = () => sizeFields.replaceChildren(row(
      numberField({ label: 'Width', unit: 'mm', value: s().card.widthMm, min: 10, step: 0.1, onChange: (v) => v > 0 && set((st) => { st.card.widthMm = v; }) }),
      numberField({ label: 'Height', unit: 'mm', value: s().card.heightMm, min: 10, step: 0.1, onChange: (v) => v > 0 && set((st) => { st.card.heightMm = v; }) }),
      numberField({ label: 'Bleed', unit: 'mm', value: s().card.bleedMm, min: 0, step: 0.5, onChange: (v) => v >= 0 && set((st) => { st.card.bleedMm = v; }) }),
    ));
    renderSize();
    const preset = selectField({
      label: 'Card size', value: `${s().card.widthMm}x${s().card.heightMm}`, options: CARD_PRESETS,
      onChange: (v) => {
        if (!v) return;
        const [w, hh] = v.split('x').map(Number);
        set((st) => { st.card.widthMm = w; st.card.heightMm = hh; });
        renderSize();
      },
    });

    const refresh = () => {
      const p = planFor(s());
      const g = frameGeometry(s());
      const mb = (g.fw * g.fh * 4 * s().plan.frames) / (1 << 20);
      stats.replaceChildren(
        stat('Pixels per lens', fmt.n(p.pitchPx, 3)),
        stat('Max frames', p.maxFrames),
        stat('Strip width per frame', `${fmt.n(p.stripPx, 2)} px`),
        stat('Eye angle at viewing distance', `${fmt.n(p.eyeAngleDeg, 1)}°`),
        stat('Viewing angle', `${fmt.n(p.viewingAngleDeg, 1)}°${p.angleKnown ? '' : ' (est.)'}`),
        stat('Frames between the eyes', fmt.n(p.framesBetweenEyes, 2)),
        stat('Depth budget per frame', `${fmt.n(p.maxShiftPxPerFrame, 1)} px`),
        stat('Total parallax', `${fmt.n(p.totalParallaxPx, 1)} px · ${fmt.n((p.totalParallaxPx / s().printer.ppi) * 25.4, 2)} mm`),
        stat('Lenses across', `${fmt.n(g.axis === 'x' ? p.lensCount.x : p.lensCount.y, 1)}`),
        stat('Working frame size', `${g.fw} × ${g.fh} px`),
        stat('Frame memory', `${fmt.n(mb, 0)} MB`),
        ...(p.depth ? [stat('Depth in use / frame', `${fmt.n(p.depth.pxPerFrame, 1)} px`)] : []),
      );
      warn.replaceChildren(warnings(p.warnings) || h('p', { class: 'ok-note' }, 'Plan looks good.'));
      cardWarn.replaceChildren(warnings(cardWarnings(s())) || '');
    };

    const framesField = numberField({
      label: 'Frames', value: s().plan.frames, step: 1, min: 2, max: 32,
      onChange: (v) => {
        const n = Math.round(v);
        if (n >= 2 && n <= 32) store.update((st) => { st.plan.frames = n; });
      },
      hint: 'Default 8. More = smoother, narrower strips.',
    });

    root.append(
      h('div', { class: 'cols' },
        card('Effect', effectArt, effectSel, ridgeSel, tip('The ridge direction follows the effect.', 'Lay the lens with its ridges this way on the print. Override it only if you know why: 3D with horizontal ridges shows no depth.')),
        card('Card', pic('bleed', 'Card + bleed', 'Red dashes = where you cut'), preset, sizeFields, tip('Bleed is extra picture past the cut line.', 'If your cut drifts a little, you cut into the bleed instead of exposing white paper. 2–3 mm is typical.')),
      ),
      cardWarn,
      h('div', { class: 'cols-wide' },
        card('Plan', stats, h('div', { style: { marginTop: '14px' } }, warn)),
        card('Settings',
          pic('framesEyes', 'Frames between the eyes', 'Aim for 1.5 or more for 3D'),
          framesField,
          numberField({
            label: 'Depth budget', unit: 'lens widths / frame', value: s().plan.budgetLensPerFrame, step: 0.1, min: 0.1, max: 3,
            onChange: (v) => v > 0 && store.update((st) => { st.plan.budgetLensPerFrame = v; }),
            hint: 'Lower = sharper but flatter.',
          }),
          row(
            numberField({ label: 'Viewing distance', unit: 'mm', value: s().plan.viewDistMm, step: 10, min: 100, onChange: (v) => v > 0 && store.update((st) => { st.plan.viewDistMm = v; }) }),
            numberField({ label: 'Eye separation', unit: 'mm', value: s().plan.ipdMm, step: 1, min: 40, onChange: (v) => v > 0 && store.update((st) => { st.plan.ipdMm = v; }) }),
          ),
          numberField({
            label: 'Frame samples per lens', value: s().plan.samplesPerLens, step: 1, min: 1, max: 8,
            onChange: (v) => v >= 1 && store.update((st) => { st.plan.samplesPerLens = Math.round(v); }),
          }),
          more('Viewing distance and eye separation set how many frames apart your eyes are. Samples per lens is the working resolution of the frames across the ridges; 2–3 is plenty because each lens shows one sample of each frame.'),
        ),
      ),
      card('Import / export',
        h('div', { class: 'btn-row' },
          button('Export plan.json', () => {
            const p = planFor(s());
            downloadJson(SLICES.plan(s(), { framesBetweenEyes: +p.framesBetweenEyes.toFixed(3), maxShiftPxPerFrame: +p.maxShiftPxPerFrame.toFixed(3), pitchPx: +p.pitchPx.toFixed(4), maxFrames: p.maxFrames }), 'plan.json');
          }),
          button('Import plan…', async () => {
            const [f] = await pickFiles({ accept: '.json,application/json' });
            if (!f) return;
            store.replaceState(applySlice(s(), await readJsonFile(f)));
            toast('Plan imported.');
            rerender();
          }, { kind: 'ghost' }),
        ),
        tip('Changing these makes built frames out of date.', 'Rebuild them in Step 5 or 6 after changing frames, card size or lens settings.'),
      ),
    );
    refresh();
    return store.on('change', refresh);
  },
};
