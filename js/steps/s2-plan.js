import { h, card, row, hint, numberField, button, downloadJson, pickFiles, readJsonFile, toast, stat, fmt, warnings } from '../ui.js';
import { lpiInUse, frameGeometry } from '../core/geometry.js';
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

export default {
  id: 2,
  title: 'Frame planner',
  subtitle: 'Frames & depth budget',
  intro: 'How many frames to use and how much depth or motion the lens can show before it blurs.',
  render(root, { store }) {
    const s = () => store.state;
    const stats = h('div', { class: 'stats' });
    const warn = h('div');

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
    };

    const framesField = numberField({
      label: 'Frames', value: s().plan.frames, step: 1, min: 2, max: 32,
      onChange: (v) => {
        const n = Math.round(v);
        if (n >= 2 && n <= 32) store.update((st) => { st.plan.frames = n; });
      },
      hint: 'Default 8. More frames = smoother, but each strip gets narrower.',
    });

    root.append(
      h('div', { class: 'cols-wide' },
        card('Plan', stats, h('div', { style: { marginTop: '14px' } }, warn)),
        card('Settings',
          framesField,
          numberField({
            label: 'Depth budget', unit: 'lens widths / frame', value: s().plan.budgetLensPerFrame, step: 0.1, min: 0.1, max: 3,
            onChange: (v) => v > 0 && store.update((st) => { st.plan.budgetLensPerFrame = v; }),
            hint: 'Rule of thumb: neighbouring frames should differ by at most about one lens width. Lower = sharper, flatter.',
          }),
          row(
            numberField({ label: 'Viewing distance', unit: 'mm', value: s().plan.viewDistMm, step: 10, min: 100, onChange: (v) => v > 0 && store.update((st) => { st.plan.viewDistMm = v; }) }),
            numberField({ label: 'Eye separation', unit: 'mm', value: s().plan.ipdMm, step: 1, min: 40, onChange: (v) => v > 0 && store.update((st) => { st.plan.ipdMm = v; }) }),
          ),
          numberField({
            label: 'Frame samples per lens', value: s().plan.samplesPerLens, step: 1, min: 1, max: 8,
            onChange: (v) => v >= 1 && store.update((st) => { st.plan.samplesPerLens = Math.round(v); }),
            hint: 'Working resolution along the interlace axis. 2–3 is plenty; each lens shows one sample per frame.',
          }),
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
            framesField.querySelector('input').value = s().plan.frames;
            toast('Plan imported.');
          }, { kind: 'ghost' }),
        ),
        hint('Changing frames, card size or lens settings makes existing frames out of date; rebuild them in Step 5 or 6.'),
      ),
    );
    refresh();
    return store.on('change', refresh);
  },
};
