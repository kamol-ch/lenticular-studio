import { h, row, tip, guide, pic, section, numberField, selectField, button, downloadBlob, downloadJson, pickFiles, readJsonFile, toast, progress, stat, fmt, warnings } from '../ui.js';
import { lpiInUse, pitchPx, MEDIA_PRESETS, testSheetMm, printableMm, fitsOn } from '../core/geometry.js';
import { SLICES, applySlice } from '../core/schema.js';
import { makePitchTest, makeAngleTest, makeFlipTest, makeSpreadTest, pitchCandidates, ANGLE_TEST_FRAMES, SPREAD_TEST_MM } from '../testsheets.js';
import { drawSheet, fmtMm } from '../scene.js';

const RESOLUTIONS = [[720, '720 ppi'], [600, '600 ppi'], [1440, '1440 ppi (experimental)'], [1200, '1200 ppi (experimental)'], [300, '300 ppi']];

const SHEETS = {
  pitch: { label: 'Pitch test', file: (s) => `pitch-test-${s.printer.ppi}ppi.png`, make: (s) => makePitchTest(s) },
  angle: { label: 'Viewing-angle test', file: () => 'angle-test.png', make: (s, p) => makeAngleTest(s, p) },
  spread: { label: 'Ink-spread test', file: () => 'ink-spread-test.png', make: (s, p) => makeSpreadTest(s, p) },
  flip: { label: 'A/B flip test', file: () => 'flip-test-AB.png', make: (s, p) => makeFlipTest(s, p) },
};

export default {
  id: 1,
  title: 'Printer & lens',
  subtitle: 'Calibrate once',
  intro: 'Measure your printer and lens once. The canvas shows each test sheet on your paper.',
  details: [
    'Calibration is about the hardware, not the card: the true lens pitch (it is never exactly what the packet says) and how far you tilt before the picture repeats.',
    'Do it once per lens and printer. Export lens-profile.json at the bottom of this step and import it for every new card.',
    'Print the pitch test on plain paper to save photo paper. Print the angle and flip tests on photo paper: their strips are too fine for plain paper.',
    'Every sheet has a border and a 50 mm bar. Measure the bar on your print: if it is not 50 mm, the print was scaled.',
  ],
  editor({ store, rerender, stage, inspector, tools }) {
    const s = () => store.state;
    const set = (fn) => store.update(fn);
    const prog = progress();
    let current = 'pitch';

    // ---------- test-sheet previews (the real files, cached) ----------
    const cache = {}; // kind → { key, blob, bitmap, pending }
    const keyOf = (kind) => { const st = s(); return JSON.stringify([kind, st.printer.ppi, st.media, st.lens, st.tests, st.interlace.marks, st.interlace.marginMm, st.interlace.reverse, st.interlace.smoothEdges]); };
    const ensure = (kind, { now = false } = {}) => {
      const key = keyOf(kind);
      const c = cache[kind] || (cache[kind] = {});
      if (c.key === key && (c.blob || c.pending)) return c.pending || Promise.resolve(c.blob);
      c.key = key; c.blob = null; c.bitmap = null; c.error = null;
      const run = async () => {
        try {
          const blob = await SHEETS[kind].make(s(), (p) => { if (kind === current) prog.set(p, 'Drawing the sheet…'); });
          if (c.key !== key) return null;
          c.blob = blob;
          c.bitmap = await createImageBitmap(blob);
        } catch (e) { c.error = e.message; }
        finally { c.pending = null; prog.done(); stage.invalidate(); }
        return c.blob;
      };
      clearTimeout(c.timer);
      c.pending = now ? run() : new Promise((res) => { c.timer = setTimeout(() => res(run()), 350); });
      return c.pending;
    };

    const layout = () => {
      const st = s(), t = testSheetMm(st.lens, st.media);
      const um = st.media.marginMm ?? 3;
      return {
        paper: { x: 0, y: 0, w: st.media.widthMm, h: st.media.heightMm },
        printable: { x: um, y: um, w: st.media.widthMm - 2 * um, h: st.media.heightMm - 2 * um },
        sheet: { x: (st.media.widthMm - t.w) / 2, y: (st.media.heightMm - t.h) / 2, w: t.w, h: t.h },
      };
    };
    let L = layout();

    stage.setScene({
      bounds: () => L.paper,
      draw(ctx, v) {
        const c = v.colors, st = s();
        drawSheet(ctx, v, L.paper);
        const cur = cache[current];
        if (cur?.bitmap) {
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(cur.bitmap, L.sheet.x, L.sheet.y, L.sheet.w, L.sheet.h);
        } else {
          ctx.fillStyle = '#f1efe9';
          ctx.fillRect(L.sheet.x, L.sheet.y, L.sheet.w, L.sheet.h);
          v.text(cur?.error || 'Drawing the sheet…', L.sheet.x + L.sheet.w / 2, L.sheet.y + L.sheet.h / 2, { align: 'center', baseline: 'middle', size: 13, color: cur?.error ? c.err : c.muted });
        }
        if (!v.guides) return;
        ctx.save();
        ctx.setLineDash([2 * v.px, 3 * v.px]); ctx.lineWidth = v.px; ctx.strokeStyle = c.line;
        ctx.strokeRect(L.printable.x, L.printable.y, L.printable.w, L.printable.h);
        ctx.restore();
        v.text(`${st.media.name || 'Paper'} · ${fmtMm(L.paper.w)} × ${fmtMm(L.paper.h)} mm`, 0, 0, { dy: -8 });
        v.text(`${SHEETS[current].label} · ${fmtMm(L.sheet.w)} × ${fmtMm(L.sheet.h)} mm · zoom in to see the lines`, L.sheet.x + L.sheet.w / 2, L.sheet.y + L.sheet.h, { align: 'center', dy: 16, color: c.text, bold: true });
        v.text('printable area', L.printable.x, L.printable.y + L.printable.h, { dx: 4, dy: -5 });
      },
    });

    // ---------- toolbar ----------
    const sheetSel = selectField({ label: 'Sheet', value: current, options: Object.entries(SHEETS).map(([k, v]) => [k, v.label]), onChange: (v) => show(v) });
    const download = (kind) => async () => {
      show(kind);
      const blob = await ensure(kind, { now: true });
      if (!blob) throw new Error(cache[kind]?.error || 'Could not draw the sheet.');
      if (kind === 'pitch') store.setAssets({ pitchTest: blob });
      downloadBlob(blob, SHEETS[kind].file(s()));
    };
    tools.append(sheetSel, button('Download this sheet', () => download(current)(), { kind: 'small primary' }));
    function show(kind) {
      current = kind;
      sheetSel.querySelector('select').value = kind;
      ensure(kind);
      stage.invalidate();
    }

    // ---------- 1 · printer ----------
    const printer = section('1 · Printer resolution',
      selectField({ label: 'Print resolution', value: s().printer.ppi, options: RESOLUTIONS, onChange: (v) => set((st) => { st.printer.ppi = Number(v); }) }),
      tip("Use your printer's native resolution.",
        'Typically 720 ppi for Epson inkjets, 600 ppi for Canon and HP.',
        'At the native resolution the driver prints the file 1:1. Any other value gets resampled, which blurs the fine strips into each other (ghosting).'));

    // ---------- 2 · paper ----------
    const mediaFields = h('div');
    const renderMedia = () => mediaFields.replaceChildren(
      row(
        numberField({ label: 'Width', unit: 'mm', value: s().media.widthMm, min: 50, step: 0.1, onChange: (v) => v > 0 && set((st) => { st.media.widthMm = v; st.media.name = null; }) }),
        numberField({ label: 'Height', unit: 'mm', value: s().media.heightMm, min: 50, step: 0.1, onChange: (v) => v > 0 && set((st) => { st.media.heightMm = v; st.media.name = null; }) })),
      numberField({ label: 'Unprintable margin', unit: 'mm', value: s().media.marginMm, min: 0, max: 20, step: 0.5, onChange: (v) => v >= 0 && set((st) => { st.media.marginMm = v; }) }));
    renderMedia();
    const paper = section('2 · Paper',
      selectField({
        label: 'Paper size', value: s().media.name || '',
        options: [...MEDIA_PRESETS.map(([n, w, hh]) => [n, `${n} (${w} × ${hh} mm)`]), ['', 'Custom…']],
        onChange: (v) => {
          const p = MEDIA_PRESETS.find(([n]) => n === v);
          if (p) set((st) => { st.media.name = p[0]; st.media.widthMm = p[1]; st.media.heightMm = p[2]; });
          else set((st) => { st.media.name = null; });
          renderMedia();
        },
      }),
      mediaFields,
      tip('The paper you load for test sheets and cards.',
        'Step 6 can tile several cards on one sheet of this paper.',
        'Keep borderless printing off: it enlarges the image slightly, which breaks the pitch. The unprintable margin keeps everything inside the area the printer can reach.'));

    // ---------- 3 · lens ----------
    const lens = section('3 · Lens',
      numberField({ label: 'Nominal LPI', unit: 'LPI', value: s().lens.lpiNominal, step: 0.1, min: 10, onChange: (v) => v > 0 && set((st) => { st.lens.lpiNominal = v; }) }),
      row(
        numberField({ label: 'Lens sheet width', unit: 'mm', value: s().lens.sheetWidthMm, placeholder: 'optional', onChange: (v) => set((st) => { st.lens.sheetWidthMm = v; }) }),
        numberField({ label: 'Lens sheet height', unit: 'mm', value: s().lens.sheetHeightMm, placeholder: 'optional', onChange: (v) => set((st) => { st.lens.sheetHeightMm = v; }) })),
      tip('From the packet. The pitch test finds the true value.',
        'LPI = lenses per inch. A 75 LPI sheet is sold as 75 but often measures 74.8–75.2 on your printer.',
        'Lens sheet size is optional. Test sheets are printed at this size (100 × 150 mm if blank) so the whole lens can sit on them.'));

    // ---------- 4 · pitch ----------
    const pitchInfo = h('p', { class: 'field-range' });
    const pitch = section('4 · Pitch test → measured LPI',
      guide([['pitchLay', 'Lay the lens on', 'Ridges parallel to the lines'], ['pitchTest', 'Find the even band', 'No broad stripes']]),
      row(
        numberField({ label: 'From', unit: 'LPI', value: s().tests.pitchFrom, step: 0.01, onChange: (v) => set((st) => { st.tests.pitchFrom = v; }) }),
        numberField({ label: 'To', unit: 'LPI', value: s().tests.pitchTo, step: 0.01, onChange: (v) => set((st) => { st.tests.pitchTo = v; }) }),
        numberField({ label: 'Step', unit: 'LPI', value: s().tests.pitchStep, step: 0.01, min: 0.01, onChange: (v) => set((st) => { st.tests.pitchStep = v; }) })),
      pitchInfo,
      h('div', { class: 'btn-row' }, button('Download pitch test', download('pitch'), { kind: 'small primary' })),
      numberField({ label: 'Measured LPI', unit: 'LPI', value: s().lens.lpiMeasured, step: 0.01, placeholder: 'the matching band', onChange: (v) => set((st) => { st.lens.lpiMeasured = v > 0 ? v : null; }) }),
      tip("Type the matching band's number above.",
        'Look straight down from about 40 cm. Most bands show broad dark and light stripes (beating). The band whose pitch matches your lens looks evenly toned across its whole width; the closer a band is, the wider its stripes.',
        'Two neighbouring bands look equally good? Use the value between them. Nothing looks even? Widen the range and print again.',
        'On paper without the lens, a fine thick/thin rhythm in the lines is normal: 9.6 pixels per lens cannot be printed evenly.'));

    // ---------- 5 · angle ----------
    const angle = section('5 · Viewing angle → measured angle',
      guide([['phoneTape', 'Tape it to a phone', 'Lens on, ridges side to side'], ['phoneTilt:12:0', 'Tilt until colour 1', 'Read the level: e.g. 12°'], ['phoneTilt:44:0', 'Tilt to the next 1', '44 − 12 = 32°']]),
      h('div', { class: 'btn-row' }, button('Download angle test', download('angle'), { kind: 'small primary' })),
      numberField({ label: 'Measured viewing angle', unit: '°', value: s().lens.angleDeg, step: 0.5, min: 5, max: 80, placeholder: 'e.g. 32', onChange: (v) => set((st) => { st.lens.angleDeg = v > 0 ? v : null; }) }),
      tip('Close one eye. Enter the difference between the two readings.',
        `The sheet shows ${ANGLE_TEST_FRAMES} numbered colours. Line the lens up with the printed strips and tape both to the back of your phone, turned so the ridges run side to side.`,
        'Open a level or inclinometer app (iPhone: Measure → Level). Keep your head still and tilt the phone toward you. Note the angle when colour 1 first appears, keep tilting through 2…8, and note the angle when colour 1 first appears again.',
        'With both eyes open and the ridges upright, each eye sees a different colour and they blur together: close one eye or keep the ridges side to side.',
        'For a steadier number, measure two full cycles and halve it. Print this sheet on photo paper: its strips are too fine for plain paper.'),
      { closed: true });

    // ---------- 6 · ink spread ----------
    const spread = section('6 · Ink spread (optional)',
      guide([['spread', 'Find the even band', 'Stripes evenly fine, no waves'], ['flip', 'Check with the lens', 'Whitest A, blackest B']]),
      h('div', { class: 'btn-row' }, button('Download ink-spread test', download('spread'), { kind: 'small primary' })),
      numberField({ label: 'Ink spread', unit: 'mm', value: s().printer.inkSpreadMm || 0, step: 0.005, min: 0, max: 0.1, placeholder: '0', onChange: (v) => set((st) => { st.printer.inkSpreadMm = v > 0 ? v : 0; }) }),
      tip('Ink creeps into the light strips. This widens them by that much.',
        `Print on the paper and settings you will use for cards. Each band has a different value (${SPREAD_TEST_MM[0]}–${SPREAD_TEST_MM[SPREAD_TEST_MM.length - 1]} mm per edge). Without the lens, under-compensated bands look darker, with a wavy rhythm where thin white strips close up; over-compensated bands look too light.`,
        'Then lay the lens on and close one eye: in the best band A is the whitest and B the blackest as you tilt. If two bands tie, use the value between them.',
        'Measured another way: scan the A/B flip test at 1200 dpi. Each white strip should be half a lens wide (0.17 mm at 75 LPI); the ink spread per edge is half of what is missing.',
        'Applies to the flip test below and to every card in Step 6. Keep it at 0 if you have not tested it.'),
      { closed: true });

    // ---------- 7 · flip ----------
    const flip = section('7 · Final check (optional)',
      pic('flip', 'A clean A ↔ B flip', 'One eye closed; little or no ghost letter'),
      h('div', { class: 'btn-row' }, button('Download A/B flip test', download('flip'), { kind: 'small' })),
      tip('Prints with your measured values: a last check before a real card.',
        'Black-on-white letters are the harshest test there is, so a faint ghost of the other letter is normal. A strong ghost across the whole sheet means the lens is not pressed flat or the ink spread (use photo paper). A ghost that changes across the sheet means the pitch is slightly off.'),
      { closed: true });

    // Opening a test's section shows that sheet on the canvas.
    [[pitch, 'pitch'], [angle, 'angle'], [spread, 'spread'], [flip, 'flip']].forEach(([sec, kind]) => sec.addEventListener('toggle', () => { if (sec.open) show(kind); }));

    // ---------- summary ----------
    const summary = h('div', { class: 'stats' });
    const summaryWarn = h('div', { style: { marginTop: '10px' } });
    const refresh = () => {
      const st = s();
      const lpi = lpiInUse(st.lens), p = pitchPx(st.printer.ppi, lpi), t = testSheetMm(st.lens, st.media);
      const nb = pitchCandidates(st.tests.pitchFrom, st.tests.pitchTo, st.tests.pitchStep).length;
      pitchInfo.textContent = nb ? `${nb} bands from ${st.tests.pitchFrom} to ${st.tests.pitchTo} LPI.` : 'Check the range: "from" must be below "to".';
      summary.replaceChildren(
        stat('LPI in use', `${fmt.n(lpi, 2)}${st.lens.lpiMeasured ? ' (measured)' : ' (nominal)'}`),
        stat('Pixels per lens', fmt.n(p, 3)),
        stat('Max frames', Math.max(2, Math.floor(p))),
        stat('Viewing angle', st.lens.angleDeg ? `${st.lens.angleDeg}°` : 'not measured'),
        stat('Ink spread', st.printer.inkSpreadMm ? `${st.printer.inkSpreadMm} mm` : 'none'),
        stat('Paper', st.media.name || `${st.media.widthMm} × ${st.media.heightMm}`),
        stat('Test sheet', `${fmt.n(t.w, 0)} × ${fmt.n(t.h, 0)} mm`));
      const ws = [];
      if (!st.lens.lpiMeasured) ws.push({ level: 'info', text: 'Pitch not measured yet: nominal LPI is used (step 4).' });
      if (!st.lens.angleDeg) ws.push({ level: 'info', text: 'Viewing angle not measured yet: 32° is assumed (step 5).' });
      if (st.printer.ppi > 720) ws.push({ level: 'info', text: `${st.printer.ppi} ppi is experimental; compare against a print at your printer's native resolution.` });
      const area = printableMm(st.media);
      if (st.lens.sheetWidthMm > 0 && st.lens.sheetHeightMm > 0 && !fitsOn(st.lens.sheetWidthMm, st.lens.sheetHeightMm, area.w, area.h)) {
        ws.push({ level: 'warn', text: 'The lens sheet is larger than the printable area of the paper; test sheets are cropped to the paper.' });
      }
      summaryWarn.replaceChildren(warnings(ws) || h('p', { class: 'ok-note' }, 'Calibrated. Export the profile to reuse it.'));
      L = layout();
      ensure(current);
      stage.fit();
    };

    inspector.append(printer, paper, lens, pitch, angle, spread, flip,
      section('Calibration summary', summary, summaryWarn,
        h('div', { class: 'btn-row', style: { marginTop: '10px' } },
          button('Export lens-profile.json', () => downloadJson(SLICES.lens(s()), 'lens-profile.json'), { kind: 'small' }),
          button('Import lens profile…', async () => {
            const [f] = await pickFiles({ accept: '.json,application/json' });
            if (!f) return;
            store.replaceState(applySlice(s(), await readJsonFile(f)));
            toast('Lens profile imported.');
            rerender();
          }, { kind: 'small ghost' })),
        tip('Reuse this file for every card with this lens.', 'It holds printer resolution, paper, lens and the measured values. The card design lives in Step 2.')),
      prog);
    refresh();
    const off = store.on('change', refresh);
    return () => { off(); Object.values(cache).forEach((c) => clearTimeout(c.timer)); };
  },
};
