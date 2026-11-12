import { h, card, row, hint, numberField, selectField, button, downloadBlob, downloadJson, pickFiles, readJsonFile, toast, progress, stat, fmt, warnings } from '../ui.js';
import { orientationForEffect, bleedBoxPx, lpiInUse, pitchPx } from '../core/geometry.js';
import { SLICES, applySlice } from '../core/schema.js';
import { makePitchTest, makeAngleTest, makeFlipTest, pitchCandidates } from '../testsheets.js';

const PRESETS = [
  ['', 'Custom…'],
  ['54x85.6', 'Credit card 54 × 85.6 mm'],
  ['63x88', 'Trading card 63 × 88 mm'],
  ['100x150', '10 × 15 cm (4 × 6 in)'],
  ['105x148', 'A6 105 × 148 mm'],
  ['127x178', '5 × 7 in'],
];

export default {
  id: 1,
  title: 'Lens & printer',
  subtitle: 'Calibrate',
  intro: 'Set up your lens, printer and card size, then print the calibration sheets and enter what you measure.',
  render(root, { store, rerender }) {
    const s = () => store.state;
    const set = (fn) => store.update(fn);

    const summary = h('div', { class: 'stats' });
    const sizeWarn = h('div');
    const refreshSummary = () => {
      const st = s();
      const b = bleedBoxPx(st.card, st.printer.ppi);
      const lpi = lpiInUse(st.lens);
      summary.replaceChildren(
        stat('LPI in use', `${fmt.n(lpi, 2)}${st.lens.lpiMeasured ? ' (measured)' : ' (nominal)'}`),
        stat('Pixels per lens', fmt.n(pitchPx(st.printer.ppi, lpi), 3)),
        stat('Output incl. bleed', `${b.w} × ${b.h} px`),
        stat('Ridges', st.lens.orientation),
      );
      const ws = [];
      const sw = st.lens.sheetWidthMm, sh = st.lens.sheetHeightMm;
      if (sw && sh) {
        const fits = (st.card.widthMm <= sw && st.card.heightMm <= sh) || (st.card.widthMm <= sh && st.card.heightMm <= sw);
        if (!fits) ws.push({ level: 'warn', text: `The card (${st.card.widthMm} × ${st.card.heightMm} mm) is larger than the lens sheet (${sw} × ${sh} mm).` });
      }
      if (st.printer.ppi !== 720) ws.push({ level: 'info', text: `${st.printer.ppi} ppi is experimental; compare against a 720 ppi print of the same file.` });
      sizeWarn.replaceChildren(warnings(ws) || '');
    };

    const preset = selectField({
      label: 'Preset', value: '', options: PRESETS,
      onChange: (v) => {
        if (!v) return;
        const [w, hh] = v.split('x').map(Number);
        set((st) => { st.card.widthMm = w; st.card.heightMm = hh; });
        rerenderCard();
      },
    });
    const cardFields = h('div');
    const rerenderCard = () => cardFields.replaceChildren(row(
      numberField({ label: 'Width', unit: 'mm', value: s().card.widthMm, min: 10, step: 0.1, onChange: (v) => v > 0 && set((st) => { st.card.widthMm = v; }) }),
      numberField({ label: 'Height', unit: 'mm', value: s().card.heightMm, min: 10, step: 0.1, onChange: (v) => v > 0 && set((st) => { st.card.heightMm = v; }) }),
      numberField({ label: 'Bleed', unit: 'mm', value: s().card.bleedMm, min: 0, step: 0.5, onChange: (v) => v >= 0 && set((st) => { st.card.bleedMm = v; }) }),
    ));
    rerenderCard();

    const orientSel = selectField({
      label: 'Ridge orientation', value: s().lens.orientation,
      options: [['vertical', 'Vertical ridges (3D)'], ['horizontal', 'Horizontal ridges (animation)']],
      onChange: (v) => set((st) => { st.lens.orientation = v; }),
      hint: 'Vertical ridges give each eye a different view (3D). Horizontal ridges flip as you tilt the card toward you (animation).',
    });

    const effect = selectField({
      label: 'Effect type', value: s().effect,
      options: [['3d', '3D depth'], ['animation', 'Animation (flip / motion)'], ['3d-motion', '3D + subtle motion']],
      onChange: (v) => {
        set((st) => { st.effect = v; st.lens.orientation = orientationForEffect(v); });
        orientSel.querySelector('select').value = s().lens.orientation;
      },
    });

    // ----- tests -----
    const prog = progress();
    const pitchInfo = h('p', { class: 'hint' });
    const refreshPitchInfo = () => {
      const t = s().tests;
      const n = pitchCandidates(t.pitchFrom, t.pitchTo, t.pitchStep).length;
      pitchInfo.textContent = n ? `${n} bands from ${t.pitchFrom} to ${t.pitchTo} LPI, printed on a ${s().card.widthMm} × ${s().card.heightMm} mm sheet.` : 'Check the range.';
    };
    refreshPitchInfo();

    const pitchTest = card('Pitch test',
      hint('Each band is a line pattern at a slightly different LPI. Lay the lens on the print, ridges parallel to the lines. The band that looks evenly dark or light across its whole width (no beating stripes) matches your lens. Enter that value as the measured LPI.'),
      row(
        numberField({ label: 'From', unit: 'LPI', value: s().tests.pitchFrom, step: 0.01, onChange: (v) => { set((st) => { st.tests.pitchFrom = v; }); refreshPitchInfo(); } }),
        numberField({ label: 'To', unit: 'LPI', value: s().tests.pitchTo, step: 0.01, onChange: (v) => { set((st) => { st.tests.pitchTo = v; }); refreshPitchInfo(); } }),
        numberField({ label: 'Step', unit: 'LPI', value: s().tests.pitchStep, step: 0.01, min: 0.01, onChange: (v) => { set((st) => { st.tests.pitchStep = v; }); refreshPitchInfo(); } }),
      ),
      pitchInfo,
      h('div', { class: 'btn-row' },
        button('Download pitch test PNG', async () => {
          prog.set(0.3, 'Drawing pitch test…');
          const blob = await makePitchTest(s());
          store.setAssets({ pitchTest: blob });
          prog.done();
          downloadBlob(blob, `pitch-test-${s().printer.ppi}ppi.png`);
        }, { kind: 'primary' }),
      ),
    );

    const angleTest = card('Viewing-angle & flip tests',
      hint(`Uses the LPI in use (measured if entered, else nominal) and ${s().plan.frames} frames (Step 2). Each frame is a solid colour with its number. Hold the card at arm's length and tilt it slowly; measure the tilt angle between two appearances of the same colour. That angle is the viewing angle.`),
      h('div', { class: 'btn-row' },
        button('Download viewing-angle test', async () => {
          const blob = await makeAngleTest(s(), (p) => prog.set(p, 'Interlacing angle test…'));
          prog.done();
          downloadBlob(blob, `angle-test-${s().plan.frames}f.png`);
        }),
        button('Download 2-frame flip test (A/B)', async () => {
          const blob = await makeFlipTest(s(), (p) => prog.set(p, 'Interlacing flip test…'));
          prog.done();
          downloadBlob(blob, 'flip-test-AB.png');
        }),
      ),
      hint('Tip: test sheets are for calibration only, so print them on plain paper first to save photo paper.'),
    );

    const measured = card('Measured values',
      row(
        numberField({ label: 'Measured LPI', unit: 'LPI', value: s().lens.lpiMeasured, step: 0.01, placeholder: 'from pitch test', onChange: (v) => { set((st) => { st.lens.lpiMeasured = v > 0 ? v : null; }); refreshSummary(); } }),
        numberField({ label: 'Viewing angle', unit: '°', value: s().lens.angleDeg, step: 0.5, min: 5, max: 80, placeholder: 'from angle test', onChange: (v) => set((st) => { st.lens.angleDeg = v > 0 ? v : null; }) }),
      ),
      hint('Leave blank until you have printed the tests; nominal values are used meanwhile.'),
    );

    const io = card('Import / export',
      hint('Save your calibration once and reuse it for every card with this lens.'),
      h('div', { class: 'btn-row' },
        button('Export lens-profile.json', () => downloadJson(SLICES.lens(s()), 'lens-profile.json')),
        button('Import lens profile…', async () => {
          const [f] = await pickFiles({ accept: '.json,application/json' });
          if (!f) return;
          store.replaceState(applySlice(s(), await readJsonFile(f)));
          toast('Lens profile imported.');
          rerender();
        }, { kind: 'ghost' }),
      ),
    );

    root.append(
      h('div', { class: 'cols' },
        card('Lens',
          row(
            numberField({ label: 'Nominal LPI', unit: 'LPI', value: s().lens.lpiNominal, step: 0.1, min: 10, onChange: (v) => v > 0 && set((st) => { st.lens.lpiNominal = v; }) }),
          ),
          effect, orientSel,
          row(
            numberField({ label: 'Lens sheet width', unit: 'mm', value: s().lens.sheetWidthMm, placeholder: 'optional', onChange: (v) => set((st) => { st.lens.sheetWidthMm = v; }) }),
            numberField({ label: 'Lens sheet height', unit: 'mm', value: s().lens.sheetHeightMm, placeholder: 'optional', onChange: (v) => set((st) => { st.lens.sheetHeightMm = v; }) }),
          ),
        ),
        card('Printer & card',
          row(
            selectField({ label: 'Printer resolution', value: s().printer.ppi, options: [[720, '720 ppi (Epson native)'], [1440, '1440 ppi (experimental)'], [600, '600 ppi'], [300, '300 ppi']], onChange: (v) => set((st) => { st.printer.ppi = Number(v); }) }),
          ),
          h('div', { class: 'field' }, h('label', {}, 'Printer'), h('div', {}, s().printer.model)),
          preset, cardFields,
        ),
      ),
      card('Summary', summary, sizeWarn),
      prog,
      h('div', { class: 'cols' }, pitchTest, angleTest),
      measured,
      io,
    );
    refreshSummary();
    const off = store.on('change', refreshSummary);
    return off;
  },
};
