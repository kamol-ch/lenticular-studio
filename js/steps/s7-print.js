import { h, checkbox, tip, more, guide, section, button, downloadBlob, stat, fmt } from '../ui.js';
import { pxToMm, lpiInUse, bleedBoxPx, mmToPx } from '../core/geometry.js';
import { planPage } from '../core/interlace.js';
import { drawSheet, fmtMm } from '../scene.js';

const CHECKLIST = [
  ['paper', 'Glossy photo paper loaded, and the matching paper type selected in the driver'],
  ['quality', 'Quality set to the highest mode'],
  ['bidir', 'Bidirectional / "High Speed" printing OFF: prevents pass misalignment and banding'],
  ['scale', 'Scaling 100%: "fit to page" off, borderless expansion off'],
  ['enhance', 'Auto-enhance / colour correction off (or the same on every print)'],
  ['patch', 'Printed a small test patch first (e.g. the 2-frame flip test) and checked it under the lens'],
];

export default {
  id: 7,
  title: 'Print & mount',
  subtitle: 'Settings & assembly',
  intro: 'Print at true size, then put the lens on. The canvas shows how the lens sits on the print.',
  details: [
    'Print from an app that respects the embedded resolution, such as IrfanView ("original size (from DPI)"), GIMP or Photoshop. Many photo viewers rescale.',
    'Measure the print: the crop marks should be exactly the card size apart.',
  ],
  editor({ store, stage, inspector, tools }) {
    const s = () => store.state;
    let showLens = true;
    let bitmap = null;
    const out = store.assets.output, info = store.assets.outputInfo;
    if (out) createImageBitmap(out).then((b) => { bitmap = b; stage.invalidate(); }).catch(() => {});

    // Same page layout as Step 6, centred on the paper.
    const layout = () => {
      const st = s(), ppi = st.printer.ppi, k = 25.4 / ppi;
      const b = bleedBoxPx(st.card, ppi);
      const m = st.interlace.marks ? Math.round(mmToPx(st.interlace.marginMm, ppi)) : 0;
      let page;
      try { page = planPage({ outW: b.w, outH: b.h, marginPx: m, tile: st.interlace.tileOnMedia, media: st.media, ppi }); }
      catch { page = planPage({ outW: b.w, outH: b.h, marginPx: m, tile: false, ppi }); }
      const pw = page.pageW * k, ph = page.pageH * k;
      let mw = st.media.widthMm, mh = st.media.heightMm;
      if ((pw > ph) !== (mw > mh) && (pw > mw || ph > mh)) [mw, mh] = [mh, mw];
      const paper = { x: 0, y: 0, w: Math.max(mw, pw), h: Math.max(mh, ph) };
      const ox = (paper.w - pw) / 2, oy = (paper.h - ph) / 2;
      return {
        paper, page: { x: ox, y: oy, w: pw, h: ph }, margin: m * k, bleed: st.card.bleedMm,
        cards: page.placements.map((p) => ({ x: ox + p.x * k, y: oy + p.y * k, w: b.w * k, h: b.h * k })),
      };
    };
    let L = layout();

    stage.setScene({
      bounds: () => L.paper,
      draw(ctx, v) {
        const c = v.colors, st = s();
        const vertical = st.orientation !== 'horizontal';
        drawSheet(ctx, v, L.paper);
        if (bitmap) {
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(bitmap, L.page.x, L.page.y, L.page.w, L.page.h);
        } else {
          for (const r of L.cards) { ctx.fillStyle = '#f1efe9'; ctx.fillRect(r.x, r.y, r.w, r.h); }
          v.text('Generate the print file in Step 6 to see it here', L.page.x + L.page.w / 2, L.page.y + L.page.h / 2, { align: 'center', baseline: 'middle', size: 13, bg: '#fff' });
        }
        const r = L.cards[0];
        const trim = { x: r.x + L.bleed, y: r.y + L.bleed, w: r.w - 2 * L.bleed, h: r.h - 2 * L.bleed };
        if (showLens) {
          // The lens sheet: covers the card and reaches the alignment strip.
          const pad = L.margin * 0.95;
          const lens = vertical ? { x: r.x, y: r.y - pad, w: r.w, h: r.h + 2 * pad } : { x: r.x - pad, y: r.y, w: r.w + 2 * pad, h: r.h };
          ctx.save();
          ctx.fillStyle = 'rgba(42,157,244,.10)';
          ctx.fillRect(lens.x, lens.y, lens.w, lens.h);
          ctx.beginPath();
          const step = Math.max(2.2, 9 * v.px);
          if (vertical) for (let x = lens.x + step / 2; x < lens.x + lens.w; x += step) { ctx.moveTo(x, lens.y); ctx.lineTo(x, lens.y + lens.h); }
          else for (let y = lens.y + step / 2; y < lens.y + lens.h; y += step) { ctx.moveTo(lens.x, y); ctx.lineTo(lens.x + lens.w, y); }
          ctx.lineWidth = v.px; ctx.strokeStyle = 'rgba(42,111,127,.45)'; ctx.stroke();
          ctx.lineWidth = 2 * v.px; ctx.strokeStyle = c.select; ctx.strokeRect(lens.x, lens.y, lens.w, lens.h);
          // Tape along one edge that runs across the ridges' ends.
          ctx.fillStyle = 'rgba(233,196,106,.85)';
          const tw = 5;
          if (vertical) ctx.fillRect(lens.x - 4, lens.y - tw / 2, lens.w + 8, tw);
          else ctx.fillRect(lens.x - tw / 2, lens.y - 4, tw, lens.h + 8);
          ctx.restore();
          if (v.guides) {
            v.text('lens, ridged side up', lens.x + lens.w / 2, lens.y + lens.h * 0.5, { align: 'center', baseline: 'middle', color: c.select, bold: true, bg: '#fff' });
            if (vertical) v.text('tape this edge first', lens.x + lens.w / 2, lens.y, { align: 'center', dy: -10, color: c.text, bold: true, bg: '#fff' });
            else v.text('tape this edge first', lens.x, lens.y + lens.h / 2, { align: 'right', dx: -10, baseline: 'middle', color: c.text, bold: true, bg: '#fff' });
          }
        }
        if (v.guides) {
          ctx.save();
          ctx.setLineDash([6 * v.px, 4 * v.px]); ctx.lineWidth = 1.5 * v.px; ctx.strokeStyle = c.trim;
          ctx.strokeRect(trim.x, trim.y, trim.w, trim.h);
          ctx.restore();
          v.text('cut here, through lens and print', trim.x + trim.w / 2, trim.y + trim.h, { align: 'center', dy: -8, color: c.trim, bold: true, bg: '#fff' });
          if (L.margin > 0) {
            if (vertical) v.text('line the ridges up with this strip', r.x + r.w / 2, r.y + r.h + L.margin * 0.68, { align: 'center', baseline: 'middle', color: c.text, bg: '#fff' });
            else v.text('line the ridges up with this strip', r.x + r.w + L.margin * 0.68, r.y + r.h * 0.75, { align: 'center', baseline: 'middle', color: c.text, bg: '#fff' });
          }
          v.text(`${st.media.name || 'Paper'} · ${fmtMm(L.paper.w)} × ${fmtMm(L.paper.h)} mm · print at 100%`, 0, 0, { dy: -8 });
        }
      },
    });

    const lensBtn = h('button', { type: 'button', class: 'btn small toggle on', 'aria-pressed': 'true' }, 'Show lens');
    lensBtn.addEventListener('click', () => { showLens = !showLens; lensBtn.classList.toggle('on', showLens); lensBtn.setAttribute('aria-pressed', showLens); stage.invalidate(); });
    tools.append(lensBtn);

    const st = s();
    inspector.append(
      section('Your file',
        out && info
          ? h('div', { class: 'stats' },
            stat('Print size', `${fmt.n(pxToMm(info.width, st.printer.ppi), 1)} × ${fmt.n(pxToMm(info.height, st.printer.ppi), 1)} mm`),
            stat('Resolution', `${st.printer.ppi} ppi`),
            stat('Lens', `${fmt.n(lpiInUse(st.lens), 2)} LPI`),
            stat('Ridges', st.orientation))
          : h('p', { class: 'hint' }, 'No print file yet: generate it in Step 6.'),
        out ? h('div', { class: 'btn-row', style: { marginTop: '10px' } }, button('Download interlaced.png', () => downloadBlob(out, 'interlaced.png'), { kind: 'primary' })) : null,
        tip('Print at actual size, then check it with a ruler.', `Use an app that respects the embedded ${st.printer.ppi} ppi, such as IrfanView ("original size (from DPI)"), GIMP or Photoshop. Many photo viewers rescale.`, 'The crop marks should be exactly the card size apart.')),
      section('Printer checklist',
        h('ul', { class: 'checklist' }, CHECKLIST.map(([k, text]) => h('li', {}, checkbox({
          label: text, checked: !!st.print.checklist[k],
          onChange: (v) => store.update((x) => { x.print.checklist[k] = v; }),
        }))))),
      section('Mounting',
        guide([['align', 'Align the lens', 'Ridges along the strip'], ['tape', 'Tape one edge', 'Once it looks right'], ['roll', 'Glue and roll', 'From the taped edge'], ['trim', 'Trim', 'Through lens and print']]),
        tip(st.orientation === 'vertical' ? 'Ridged side up, ridges running top to bottom.' : 'Ridged side up, ridges running left to right.'),
        more(h('ol', { class: 'steps-list' },
          h('li', {}, 'Let the print dry fully (at least 1 hour for dye inks; overnight is safer).'),
          h('li', {}, 'Find the ridge direction: run a fingernail across the lens; the ridged side faces you, smooth side down.'),
          h('li', {}, 'Lay the lens on the print. Line a ridge up with the alignment strip: when aligned, the whole strip goes dark or light at once as you tilt; diagonal bands mean it is rotated.'),
          h('li', {}, 'Tape one edge down once it looks right.'),
          h('li', {}, 'Lift the free side, apply adhesive (double-sided film or spray), and roll it down from the taped edge with a brayer to push out air.'),
          h('li', {}, 'Trim along the crop marks with a sharp knife and steel ruler, through the lens and print together.')))),
      section('Troubleshooting',
        h('dl', { class: 'trouble' },
          h('dt', {}, 'Bands or beating stripes across the card'), h('dd', {}, 'Pitch is off: re-run the pitch test and enter the measured LPI. Also check bidirectional (High Speed) printing is OFF.'),
          h('dt', {}, 'Ghosting / double images'), h('dd', {}, 'Too much motion or depth per frame. Lower depth strength (Step 5) or effect amounts (Step 4), or the depth budget (Step 2). Also press the lens flat: a gap blurs the strips together.'),
          h('dt', {}, 'Effect happens in the wrong direction'), h('dd', {}, 'Rotate the lens 90°, or change the ridge direction in Step 2 and re-interlace.'),
          h('dt', {}, '3D looks inside-out'), h('dd', {}, 'Toggle "Reverse frame order" in Step 6 and print again.'),
          h('dt', {}, 'Fine at one angle, smeared at others'), h('dd', {}, 'The lens is slightly rotated. Re-align it using the alignment strips before gluing.'),
          h('dt', {}, 'Print size is wrong'), h('dd', {}, 'The print app scaled the image. Turn off fit-to-page and print at 100% / actual size.')),
        { closed: true }),
    );

    const off = store.on('change', () => { L = layout(); stage.invalidate(); });
    return () => { off(); bitmap?.close?.(); };
  },
};
