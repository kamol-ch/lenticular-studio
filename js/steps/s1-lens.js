import { h, card, row, hint, numberField, selectField, button, downloadBlob, downloadJson, pickFiles, readJsonFile, toast, progress, stat, fmt, warnings } from '../ui.js';
import { lpiInUse, pitchPx, MEDIA_PRESETS, testSheetMm, printableMm } from '../core/geometry.js';
import { SLICES, applySlice } from '../core/schema.js';
import { makePitchTest, makeAngleTest, makeFlipTest, pitchCandidates, ANGLE_TEST_FRAMES } from '../testsheets.js';

const RESOLUTIONS = [[720, '720 ppi'], [600, '600 ppi'], [1440, '1440 ppi (experimental)'], [1200, '1200 ppi (experimental)'], [300, '300 ppi']];

export default {
  id: 1,
  title: 'Printer & lens',
  subtitle: 'Calibrate once',
  intro: 'Calibrate your printer and lens. You only do this once per lens: export the profile at the end and import it for every new card.',
  render(root, { store, rerender }) {
    const s = () => store.state;
    const set = (fn) => store.update(fn);
    const prog = progress();

    const sheetLabel = () => { const t = testSheetMm(s().lens, s().media); return `${fmt.n(t.w, 0)} × ${fmt.n(t.h, 0)} mm`; };

    // ---------- 1 · printer ----------
    const printer = card('1 · Printer resolution',
      selectField({
        label: 'Print resolution', value: s().printer.ppi, options: RESOLUTIONS,
        onChange: (v) => set((st) => { st.printer.ppi = Number(v); }),
        hint: "Use your printer's native input resolution: typically 720 ppi for Epson inkjets, 600 ppi for Canon and HP. Files at this resolution reach the paper without resampling.",
      }),
    );

    // ---------- 2 · paper ----------
    const mediaFields = h('div');
    const renderMedia = () => mediaFields.replaceChildren(
      row(
        numberField({ label: 'Width', unit: 'mm', value: s().media.widthMm, min: 50, step: 0.1, onChange: (v) => v > 0 && set((st) => { st.media.widthMm = v; st.media.name = null; }) }),
        numberField({ label: 'Height', unit: 'mm', value: s().media.heightMm, min: 50, step: 0.1, onChange: (v) => v > 0 && set((st) => { st.media.heightMm = v; st.media.name = null; }) }),
      ),
      numberField({ label: 'Unprintable margin', unit: 'mm', value: s().media.marginMm, min: 0, max: 20, step: 0.5, onChange: (v) => v >= 0 && set((st) => { st.media.marginMm = v; }), hint: 'Borderless printing stays off (it enlarges the image), so keep a few mm clear.' }),
    );
    renderMedia();
    const paper = card('2 · Paper',
      selectField({
        label: 'Paper size', value: s().media.name || '',
        options: [...MEDIA_PRESETS.map(([n, w, hh]) => [n, `${n} (${w} × ${hh} mm)`]), ['', 'Custom…']],
        onChange: (v) => {
          const p = MEDIA_PRESETS.find(([n]) => n === v);
          if (p) set((st) => { st.media.name = p[0]; st.media.widthMm = p[1]; st.media.heightMm = p[2]; });
          else set((st) => { st.media.name = null; });
          renderMedia();
        },
        hint: 'The paper you load. Test sheets print on it, and Step 6 can tile several cards on one sheet.',
      }),
      mediaFields,
    );

    // ---------- 3 · lens ----------
    const lens = card('3 · Lens',
      numberField({ label: 'Nominal LPI', unit: 'LPI', value: s().lens.lpiNominal, step: 0.1, min: 10, onChange: (v) => v > 0 && set((st) => { st.lens.lpiNominal = v; }), hint: 'As sold, e.g. 75. The pitch test measures the true value.' }),
      row(
        numberField({ label: 'Lens sheet width', unit: 'mm', value: s().lens.sheetWidthMm, placeholder: 'optional', onChange: (v) => set((st) => { st.lens.sheetWidthMm = v; }) }),
        numberField({ label: 'Lens sheet height', unit: 'mm', value: s().lens.sheetHeightMm, placeholder: 'optional', onChange: (v) => set((st) => { st.lens.sheetHeightMm = v; }) }),
      ),
      hint('Test sheets match the lens sheet size (100 × 150 mm if blank) so the whole lens can sit on them.'),
    );

    // ---------- 4 · pitch test ----------
    const pitchInfo = h('p', { class: 'hint' });
    const refreshPitchInfo = () => {
      const t = s().tests;
      const n = pitchCandidates(t.pitchFrom, t.pitchTo, t.pitchStep).length;
      pitchInfo.textContent = n ? `${n} bands from ${t.pitchFrom} to ${t.pitchTo} LPI on a ${sheetLabel()} sheet.` : 'Check the range: "from" must be below "to".';
    };
    const pitch = card('4 · Pitch test → measured LPI',
      hint('Print the sheet, lay the lens on it with the ridges parallel to the lines, and look straight down. Most bands show broad stripes; the band that looks evenly toned across its width matches your lens.'),
      row(
        numberField({ label: 'From', unit: 'LPI', value: s().tests.pitchFrom, step: 0.01, onChange: (v) => { set((st) => { st.tests.pitchFrom = v; }); refreshPitchInfo(); } }),
        numberField({ label: 'To', unit: 'LPI', value: s().tests.pitchTo, step: 0.01, onChange: (v) => { set((st) => { st.tests.pitchTo = v; }); refreshPitchInfo(); } }),
        numberField({ label: 'Step', unit: 'LPI', value: s().tests.pitchStep, step: 0.01, min: 0.01, onChange: (v) => { set((st) => { st.tests.pitchStep = v; }); refreshPitchInfo(); } }),
      ),
      pitchInfo,
      h('div', { class: 'btn-row' },
        button('Download pitch test', async () => {
          prog.set(0.3, 'Drawing pitch test…');
          const blob = await makePitchTest(s());
          store.setAssets({ pitchTest: blob });
          prog.done();
          downloadBlob(blob, `pitch-test-${s().printer.ppi}ppi.png`);
        }, { kind: 'primary' })),
      numberField({
        label: 'Measured LPI', unit: 'LPI', value: s().lens.lpiMeasured, step: 0.01, placeholder: 'the matching band',
        onChange: (v) => set((st) => { st.lens.lpiMeasured = v > 0 ? v : null; }),
      }),
    );

    // ---------- 5 · viewing angle ----------
    const angle = card('5 · Viewing-angle test → measured angle',
      hint(`${ANGLE_TEST_FRAMES} solid colours numbered 1–${ANGLE_TEST_FRAMES}, interlaced at the LPI in use (measured, once entered). Put the lens on with the ridges vertical and turn the sheet slowly left to right at arm's length. The angle you turn from one appearance of colour 1 to the next is the viewing angle.`),
      h('div', { class: 'btn-row' },
        button('Download viewing-angle test', async () => {
          const blob = await makeAngleTest(s(), (p) => prog.set(p, 'Interlacing angle test…'));
          prog.done();
          downloadBlob(blob, 'angle-test.png');
        }, { kind: 'primary' })),
      numberField({
        label: 'Measured viewing angle', unit: '°', value: s().lens.angleDeg, step: 0.5, min: 5, max: 80, placeholder: 'e.g. 32',
        onChange: (v) => set((st) => { st.lens.angleDeg = v > 0 ? v : null; }),
      }),
    );

    // ---------- 6 · flip ----------
    const flip = card('6 · Final check (optional)',
      hint('A two-frame A/B flip printed with your measured values. A clean switch between A and B, with no stripes, confirms the calibration before you spend photo paper on a card.'),
      h('div', { class: 'btn-row' },
        button('Download A/B flip test', async () => {
          const blob = await makeFlipTest(s(), (p) => prog.set(p, 'Interlacing flip test…'));
          prog.done();
          downloadBlob(blob, 'flip-test-AB.png');
        })),
    );

    // ---------- summary ----------
    const summary = h('div', { class: 'stats' });
    const summaryWarn = h('div', { style: { marginTop: '12px' } });
    const refreshSummary = () => {
      const st = s();
      const lpi = lpiInUse(st.lens);
      const p = pitchPx(st.printer.ppi, lpi);
      summary.replaceChildren(
        stat('LPI in use', `${fmt.n(lpi, 2)}${st.lens.lpiMeasured ? ' (measured)' : ' (nominal)'}`),
        stat('Pixels per lens', fmt.n(p, 3)),
        stat('Max frames', Math.max(2, Math.floor(p))),
        stat('Viewing angle', st.lens.angleDeg ? `${st.lens.angleDeg}°` : 'not measured'),
        stat('Paper', st.media.name || `${st.media.widthMm} × ${st.media.heightMm} mm`),
        stat('Test sheet', sheetLabel()),
      );
      const ws = [];
      if (!st.lens.lpiMeasured) ws.push({ level: 'info', text: 'Pitch not measured yet: nominal LPI is used until you enter the measured value (step 4).' });
      if (!st.lens.angleDeg) ws.push({ level: 'info', text: 'Viewing angle not measured yet: 32° is assumed (step 5).' });
      if (st.printer.ppi > 720) ws.push({ level: 'info', text: `${st.printer.ppi} ppi is experimental; compare against a print at your printer's native resolution.` });
      const area = printableMm(st.media);
      if (st.lens.sheetWidthMm > 0 && st.lens.sheetHeightMm > 0 && !((st.lens.sheetWidthMm <= area.w && st.lens.sheetHeightMm <= area.h) || (st.lens.sheetWidthMm <= area.h && st.lens.sheetHeightMm <= area.w))) {
        ws.push({ level: 'warn', text: 'The lens sheet is larger than the printable area of the paper; test sheets are cropped to the paper.' });
      }
      summaryWarn.replaceChildren(warnings(ws) || h('p', { class: 'ok-note' }, 'Calibrated. Export the profile to reuse it.'));
      refreshPitchInfo();
    };

    const io = card('Calibration summary', summary, summaryWarn,
      h('div', { class: 'btn-row', style: { marginTop: '12px' } },
        button('Export lens-profile.json', () => downloadJson(SLICES.lens(s()), 'lens-profile.json')),
        button('Import lens profile…', async () => {
          const [f] = await pickFiles({ accept: '.json,application/json' });
          if (!f) return;
          store.replaceState(applySlice(s(), await readJsonFile(f)));
          toast('Lens profile imported.');
          rerender();
        }, { kind: 'ghost' })),
      hint('The profile holds printer resolution, paper, lens and measured values. Card design lives in Step 2.'),
    );

    root.append(
      h('div', { class: 'cols' }, printer, paper, lens),
      prog,
      h('div', { class: 'cols' }, pitch, angle),
      flip,
      io,
    );
    refreshSummary();
    return store.on('change', refreshSummary);
  },
};
