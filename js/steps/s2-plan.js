import { h, row, tip, more, section, numberField, selectField, button, downloadJson, pickFiles, readJsonFile, toast, stat, fmt, warnings } from '../ui.js';
import { lpiInUse, frameGeometry, orientationForEffect, printableMm, fitsOn, mmToPx } from '../core/geometry.js';
import { computePlan, BUDGET_RANGE, SAMPLES_RANGE } from '../core/planner.js';
import { maxMotionMmPerFrame } from '../core/motion.js';
import { SLICES, applySlice } from '../core/schema.js';
import { paperLayout, drawCardOnPaper, drawRidges, createCardImage, drawLensWidget } from '../scene.js';
import { frameSource } from '../compose.js';

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
  optional: false,
  intro: 'Choose the effect and card size. The canvas shows the card on your paper.',
  details: [
    '3D needs vertical ridges, so your two eyes look through different strips and see different views. Animation uses horizontal ridges, so both eyes see the same frame and it changes as you tilt the card toward you.',
    'On the canvas: red dashes are the cut line, the red band is bleed, the blue outline is your lens sheet, and the dotted line is the paper\'s printable area. Turn labels off with Guides.',
    'Frames between the eyes: how many frames apart your two eyes are at viewing distance. Under 1.5 the 3D looks weak.',
  ],
  editor({ store, rerender, stage, inspector }) {
    const s = () => store.state;
    const set = (fn) => store.update(fn);

    // ---------- canvas ----------
    const cardImage = createCardImage(store);
    let L = paperLayout(s());
    stage.setScene({
      bounds: () => L.paper,
      draw(ctx, v) {
        const has = !!frameSource(s(), store.assets);
        drawCardOnPaper(ctx, v, L, s(), { image: has ? cardImage.get(v, L.card) : null, emptyText: 'Your card' });
        drawRidges(ctx, v, L, s().orientation);
        if (v.guides) {
          const p = planFor(s()), n = s().plan.frames, c = (n - 1) / 2, half = p.framesBetweenEyes / 2;
          const clampI = (i) => Math.max(0, Math.min(n - 1, Math.round(i)));
          const wants3d = s().effect !== 'animation';
          drawLensWidget(ctx, v, wants3d
            ? { n, active: [clampI(c - half), clampI(c + half)], tags: ['L', 'R'], reverse: false, label: `Eyes ${p.framesBetweenEyes.toFixed(1)} frames apart${p.framesBetweenEyes < 1.5 ? ' (weak 3D)' : ''}` }
            : { n, active: [clampI(c)], label: `${n} frames · both eyes see the same one` });
        }
      },
    });

    // ---------- effect ----------
    const ridgeSel = selectField({ label: 'Ridge direction', value: s().orientation, options: RIDGES, onChange: (v) => set((st) => { st.orientation = v; }) });
    const effectSel = selectField({
      label: 'Effect', value: s().effect, options: EFFECTS,
      onChange: (v) => {
        set((st) => { st.effect = v; st.orientation = orientationForEffect(v); });
        ridgeSel.querySelector('select').value = s().orientation;
      },
    });

    // ---------- card ----------
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
    const cardWarn = h('div');

    // ---------- frames & depth ----------
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const framesRange = h('p', { class: 'field-range' });
    const budgetRange = h('p', { class: 'field-range' });
    const maxLine = h('p');
    const framesField = numberField({
      label: 'Frames', value: s().plan.frames, step: 1, min: 2, max: planFor(s()).maxFrames,
      onChange: (v, input) => {
        if (v == null) return;
        const n = clamp(Math.round(v), 2, planFor(s()).maxFrames);
        input.value = n;
        if (n !== Math.round(v)) toast(`Frames limited to ${n}: the most this lens and printer can hold.`);
        set((st) => { st.plan.frames = n; });
      },
    });
    const budgetField = numberField({
      label: 'Depth budget', unit: 'lens widths / frame', value: s().plan.budgetLensPerFrame, step: 0.1, min: BUDGET_RANGE.min, max: BUDGET_RANGE.max,
      onChange: (v, input) => {
        if (v == null) return;
        const b = +clamp(v, BUDGET_RANGE.min, BUDGET_RANGE.max).toFixed(2);
        input.value = b;
        set((st) => { st.plan.budgetLensPerFrame = b; });
      },
    });
    const samplesField = numberField({
      label: 'Frame samples per lens', value: s().plan.samplesPerLens, step: 1, min: SAMPLES_RANGE.min, max: SAMPLES_RANGE.max,
      onChange: (v, input) => {
        if (v == null) return;
        const n = clamp(Math.round(v), SAMPLES_RANGE.min, SAMPLES_RANGE.max);
        input.value = n;
        set((st) => { st.plan.samplesPerLens = n; });
      },
    });

    // ---------- plan ----------
    const stats = h('div', { class: 'stats' });
    const warn = h('div', { style: { marginTop: '10px' } });

    const refresh = () => {
      const st = s();
      const p = planFor(st);
      const g = frameGeometry(st);
      const r = p.frameRange;
      L = paperLayout(st);
      cardImage.touch();
      stage.invalidate();

      framesField.querySelector('input').max = p.maxFrames;
      const use = r.wants3d
        ? (r.reachable ? `Use ${r.min}–${r.max} for 3D.` : `Use ${r.max} (strong 3D is out of reach with this lens).`)
        : `Use 2–${r.max} for animation.`;
      framesRange.textContent = `Range 2–${p.maxFrames} · ${use} Default 8.`;
      maxLine.textContent = `Maximum = pixels per lens, rounded down: ${st.printer.ppi} ppi ÷ ${fmt.n(lpiInUse(st.lens), 2)} LPI = ${fmt.n(p.pitchPx, 2)} → ${p.maxFrames} frames. Every frame needs at least one printed pixel in each lens.`;
      budgetRange.textContent = `${BUDGET_RANGE.min}–${BUDGET_RANGE.max} · 1.0 = ${fmt.n(p.pitchPx, 1)} px per frame here. 0.5 sharp, 1.0 usual, over 1.5 ghosty.`;

      const mb = (g.fw * g.fh * 4 * st.plan.frames) / (1 << 20);
      stats.replaceChildren(
        stat('Pixels per lens', fmt.n(p.pitchPx, 3)),
        stat('Max frames', p.maxFrames),
        stat('Frames between eyes', fmt.n(p.framesBetweenEyes, 2)),
        stat('Viewing angle', `${fmt.n(p.viewingAngleDeg, 1)}°${p.angleKnown ? '' : ' (est.)'}`),
        stat('Depth budget / frame', `${fmt.n(p.maxShiftPxPerFrame, 1)} px`),
        stat('Total depth', `${fmt.n((p.totalParallaxPx / st.printer.ppi) * 25.4, 2)} mm`),
        stat('Strip per frame', `${fmt.n(p.stripPx, 2)} px`),
        stat('Lenses across', fmt.n(g.axis === 'x' ? p.lensCount.x : p.lensCount.y, 0)),
        stat('Working frame', `${g.fw} × ${g.fh}`),
        stat('Frame memory', `${fmt.n(mb, 0)} MB`),
      );
      warn.replaceChildren(warnings(p.warnings) || h('p', { class: 'ok-note' }, 'Plan looks good.'));
      cardWarn.replaceChildren(warnings(cardWarnings(st)) || '');
    };

    inspector.append(
      section('Effect', effectSel, ridgeSel,
        tip('The ridge lines and arrow on the canvas show how the lens goes on.', 'The ridge direction follows the effect. Override it only if you know why: 3D with horizontal ridges shows no depth.')),
      section('Card', preset, sizeFields, cardWarn,
        tip('Bleed is extra picture past the cut line.', 'If your cut drifts a little, you cut into the bleed instead of exposing white paper. 2–3 mm is typical.')),
      section('Frames & depth',
        framesField, framesRange,
        more(maxLine,
          'For 3D your two eyes must land at least 1.5 frames apart: frames between the eyes ≈ eye angle × frames ÷ viewing angle. That sets the 3D minimum. Animation works from 2 frames (a simple flip).',
          'More frames make tilting smoother, but each frame gets a narrower strip.'),
        budgetField, budgetRange,
        more('The most anything in the picture may move from one frame to the next, in lens widths. If an object jumps further than about one lens between frames, the lens shows two copies of it: ghosting.',
          'It is not measured: it trades sharpness for depth. Steps 4 and 5 use it to cap layer shifts and motion. Total depth front to back = budget × (frames − 1).',
          'Leave it at 1. Lower it if a test print shows double edges; raise it a little if the 3D looks flat but stays sharp.')),
      section('Plan', stats, warn),
      section('Advanced',
        row(
          numberField({ label: 'Viewing distance', unit: 'mm', value: s().plan.viewDistMm, step: 10, min: 100, onChange: (v) => v > 0 && set((st) => { st.plan.viewDistMm = v; }) }),
          numberField({ label: 'Eye separation', unit: 'mm', value: s().plan.ipdMm, step: 1, min: 40, onChange: (v) => v > 0 && set((st) => { st.plan.ipdMm = v; }) }),
        ),
        more('Used only to work out how many frames apart your eyes are. 400 mm (arm\'s length) and 63 mm (average adult) suit most people. For a card on a wall, enter that distance.'),
        samplesField,
        h('p', { class: 'field-range' }, `${SAMPLES_RANGE.min}–${SAMPLES_RANGE.max} · 2–3 is plenty. Leave at 3.`),
        more('An internal memory setting, not a property of your hardware. Frames are stored squeezed across the ridges, because each lens shows only one thin strip of each frame. 3 means 3 pixels per lens width.',
          '1 is too coarse (fine detail can turn into moiré). 4–8 look the same as 3 but use more memory and run slower.'),
        { closed: true }),
      section('Import / export',
        h('div', { class: 'btn-row' },
          button('Export plan.json', () => {
            const p = planFor(s());
            downloadJson(SLICES.plan(s(), { framesBetweenEyes: +p.framesBetweenEyes.toFixed(3), maxShiftPxPerFrame: +p.maxShiftPxPerFrame.toFixed(3), pitchPx: +p.pitchPx.toFixed(4), maxFrames: p.maxFrames }), 'plan.json');
          }, { kind: 'small' }),
          button('Import plan…', async () => {
            const [f] = await pickFiles({ accept: '.json,application/json' });
            if (!f) return;
            store.replaceState(applySlice(s(), await readJsonFile(f)));
            toast('Plan imported.');
            rerender();
          }, { kind: 'small ghost' })),
        tip('Changing these makes built frames out of date.', 'Rebuild them in Step 5 or 6 after changing frames, card size or lens settings.'),
        { closed: true }),
    );
    refresh();
    const offs = [store.on('change', refresh), store.on('assets', refresh)];
    return () => offs.forEach((f) => f());
  },
};
