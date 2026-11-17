import { h, hint, section, numberField, slider, checkbox, button, downloadBlob, pickFiles, toast, clear, progress, stat, fmt, warnings } from '../ui.js';
import { bleedBoxPx, frameGeometry, lpiInUse, mmToPx, pxToMm } from '../core/geometry.js';
import { planPage } from '../core/interlace.js';
import { makeCanvas, ctx2d } from '../canvas.js';
import { frameSource } from '../compose.js';
import { buildFinalFrames, interlaceCurrentFrames, previewCrop } from '../pipeline.js';
import { importFrames, exportFrames } from '../project-io.js';
import { drawSheet, drawLensWidget } from '../scene.js';
import { mountTiltStrip } from '../tiltstrip.js';
import { planFor } from './s2-plan.js';

export default {
  id: 6,
  title: 'Slice & interlace',
  subtitle: 'Make the print file',
  intro: 'The canvas shows the sheet as it will print. Zoom in to see the strips.',
  details: [
    'Drag the tilt slider under the canvas to see what the lens will show at each angle.',
    'Zoom in far enough (or press "Show strips") and the canvas switches to the real printed pixels: the frames sliced into strips at your exact lens pitch.',
    'Registration strip: outside the card, one strip per lens is black. With the lens aligned, the whole strip goes dark at once as you tilt; diagonal bands mean the lens is rotated.',
    'The PNG carries its print resolution, so it prints at true size from an app that respects it.',
  ],
  editor({ store, stage, inspector, tools, strip }) {
    const s = () => store.state;
    const prog = progress();
    const mmPerPx = () => 25.4 / s().printer.ppi;
    const viewDeg = () => planFor(s()).viewingAngleDeg;

    // ---------- layout of the printed page (mm) ----------
    let P = null;
    const layout = () => {
      const st = s(), ppi = st.printer.ppi;
      const b = bleedBoxPx(st.card, ppi);
      const m = st.interlace.marks ? Math.round(mmToPx(st.interlace.marginMm, ppi)) : 0;
      let page, error = null;
      try {
        page = planPage({ outW: b.w, outH: b.h, marginPx: m, tile: st.interlace.tileOnMedia, media: st.media, ppi });
      } catch (e) {
        error = e.message;
        page = planPage({ outW: b.w, outH: b.h, marginPx: m, tile: false, ppi });
      }
      const k = mmPerPx();
      P = {
        error, pagePx: { w: page.pageW, h: page.pageH }, marginPx: m, out: b,
        page: { x: 0, y: 0, w: page.pageW * k, h: page.pageH * k },
        cards: page.placements.map((p) => ({ x: p.x * k, y: p.y * k, w: b.w * k, h: b.h * k })),
        margin: m * k, bleed: st.card.bleedMm,
      };
    };

    layout();

    // ---------- real pixels when zoomed in ----------
    let crop = null, cropToken = 0, cropTimer = 0;
    const dropCrop = () => { crop = null; cropToken++; };
    const requestCrop = (v) => {
      clearTimeout(cropTimer);
      cropTimer = setTimeout(async () => {
        if (!store.assets.frames.length || store.framesStatus().stale) return;
        const k = mmPerPx();
        const x0 = Math.max(0, Math.floor(v.visible.x / k)), y0 = Math.max(0, Math.floor(v.visible.y / k));
        const x1 = Math.min(P.pagePx.w, Math.ceil((v.visible.x + v.visible.w) / k)), y1 = Math.min(P.pagePx.h, Math.ceil((v.visible.y + v.visible.h) / k));
        let w = x1 - x0, hh = y1 - y0;
        if (w < 2 || hh < 2) return;
        const MAXW = 2400, MAXH = 1800;
        const cx0 = w > MAXW ? x0 + Math.floor((w - MAXW) / 2) : x0, cy0 = hh > MAXH ? y0 + Math.floor((hh - MAXH) / 2) : y0;
        w = Math.min(w, MAXW); hh = Math.min(hh, MAXH);
        if (crop && crop.x0 <= cx0 && crop.y0 <= cy0 && crop.x0 + crop.w >= cx0 + w && crop.y0 + crop.h >= cy0 + hh) return;
        const token = ++cropToken;
        try {
          const r = await previewCrop(cx0, cy0, w, hh);
          if (token !== cropToken) return;
          const c = makeCanvas(r.w, r.h);
          ctx2d(c).putImageData(new ImageData(new Uint8ClampedArray(r.buffer), r.w, r.h), 0, 0);
          crop = { canvas: c, x0: r.x0, y0: r.y0, w: r.w, h: r.h };
          stage.invalidate();
        } catch (e) { console.warn(e); }
      }, 140);
    };

    const ts = mountTiltStrip(strip, {
      frames: () => store.assets.frames,
      viewDeg,
      aspect: () => { const g = frameGeometry(s()); return g.outW / g.outH; },
      onChange: () => stage.invalidate(),
    });
    const currentFrame = () => store.assets.frames[ts.index()] || null;

    stage.setScene({
      bounds: () => P.page,
      draw(ctx, v) {
        const c = v.colors, st = s(), k = mmPerPx();
        const vertical = st.orientation !== 'horizontal';
        drawSheet(ctx, v, P.page);
        const frame = currentFrame();
        P.cards.forEach((r, i) => {
          if (frame) { ctx.imageSmoothingQuality = 'high'; ctx.drawImage(frame, r.x, r.y, r.w, r.h); }
          else { ctx.fillStyle = '#f1efe9'; ctx.fillRect(r.x, r.y, r.w, r.h); }
          if (P.margin > 0) {
            // Schematic marks: registration strips and crop ticks (the real ones appear when zoomed in).
            const a = P.margin * 0.45, b = P.margin * 0.9;
            ctx.fillStyle = 'rgba(0,0,0,.28)';
            if (vertical) { ctx.fillRect(r.x, r.y - b, r.w, b - a); ctx.fillRect(r.x, r.y + r.h + a, r.w, b - a); }
            else { ctx.fillRect(r.x - b, r.y, b - a, r.h); ctx.fillRect(r.x + r.w + a, r.y, b - a, r.h); }
            ctx.strokeStyle = '#000'; ctx.lineWidth = Math.max(0.12, 1 * v.px);
            const t0 = 1, t1 = P.margin * 0.4, bl = P.bleed;
            ctx.beginPath();
            for (const x of [r.x + bl, r.x + r.w - bl]) { ctx.moveTo(x, r.y - t0); ctx.lineTo(x, r.y - t1); ctx.moveTo(x, r.y + r.h + t0); ctx.lineTo(x, r.y + r.h + t1); }
            for (const y of [r.y + bl, r.y + r.h - bl]) { ctx.moveTo(r.x - t0, y); ctx.lineTo(r.x - t1, y); ctx.moveTo(r.x + r.w + t0, y); ctx.lineTo(r.x + r.w + t1, y); }
            ctx.stroke();
          }
          if (v.guides && i === 0) {
            ctx.save();
            ctx.setLineDash([6 * v.px, 4 * v.px]); ctx.lineWidth = 1.5 * v.px; ctx.strokeStyle = c.trim;
            ctx.strokeRect(r.x + P.bleed, r.y + P.bleed, r.w - 2 * P.bleed, r.h - 2 * P.bleed);
            ctx.restore();
          }
        });
        if (!frame) v.text('No frames yet: build or import them (Frames, on the right)', P.page.w / 2, P.page.h / 2, { align: 'center', baseline: 'middle', size: 13, bg: '#fff' });

        // Real print pixels once one printed pixel is big enough to see.
        const devPerOut = (v.k * v.dpr) * k;
        const real = devPerOut >= 0.6 && frame && !store.framesStatus().stale;
        if (real) {
          requestCrop(v);
          if (crop) {
            ctx.imageSmoothingEnabled = devPerOut < 1.5;
            ctx.drawImage(crop.canvas, crop.x0 * k, crop.y0 * k, crop.w * k, crop.h * k);
            ctx.imageSmoothingEnabled = true;
          }
        }

        if (v.guides) {
          const r = P.cards[0];
          v.text(`Prints at ${fmt.n(P.page.w, 1)} × ${fmt.n(P.page.h, 1)} mm · ${st.printer.ppi} ppi`, 0, 0, { dy: -8 });
          if (real && crop) v.text('Actual print pixels', P.page.w, 0, { align: 'right', dy: -8, color: c.primary, bold: true });
          if (P.margin > 0) {
            if (vertical) v.text('alignment strip', r.x + r.w, r.y - P.margin * 0.45, { align: 'right', dy: 13, color: c.text, bg: '#fff' });
            else v.text('alignment strip', r.x - P.margin * 0.9, r.y, { dy: -4, color: c.text, bg: '#fff' });
            v.text('crop mark', r.x + P.bleed, r.y - P.margin * 0.4, { dx: 5, dy: 4, baseline: 'top', color: c.text, bg: '#fff' });
          }
          v.text('cut line', r.x + P.bleed, r.y + P.bleed, { dx: 6, dy: 14, color: c.trim, bold: true, bg: '#fff' });
          const n = store.assets.frames.length || st.plan.frames;
          drawLensWidget(ctx, v, { n, active: [ts.index()], reverse: st.interlace.reverse, label: `Frame ${ts.index() + 1} of ${n} · ${vertical ? 'turn left / right' : 'tilt toward / away'}` });
        }
      },
    });

    const framesNote = h('p');
    const refreshFrames = () => {
      const fs = store.framesStatus();
      ts.refresh();
      framesNote.className = fs.ok ? 'ok-note' : 'hint';
      framesNote.textContent = `${fs.text}${store.assets.framesSource ? ` · ${store.assets.framesSource}` : ''}`;
      dropCrop();
      stage.invalidate();
    };

    // ---------- inspector ----------
    const stats = h('div', { class: 'stats' });
    const statsWarn = h('div', { style: { marginTop: '10px' } });
    const result = h('div');
    const refreshStats = () => {
      layout();
      const st = s(), ppi = st.printer.ppi;
      stats.replaceChildren(
        stat('Print size', `${fmt.n(pxToMm(P.pagePx.w, ppi), 1)} × ${fmt.n(pxToMm(P.pagePx.h, ppi), 1)} mm`),
        stat('Pixels', `${P.pagePx.w} × ${P.pagePx.h}`),
        stat('Pitch', `${fmt.n(ppi / lpiInUse(st.lens), 3)} px`),
        stat('LPI', fmt.n(lpiInUse(st.lens), 2)),
        stat('Frames', st.plan.frames),
        stat('Cards', P.cards.length),
      );
      const ws = [];
      if (P.error) ws.push({ level: 'error', text: `${P.error} Showing a single card.` });
      if (!st.lens.lpiMeasured) ws.push({ level: 'info', text: 'Using nominal LPI. Run the pitch test (Step 1) for a sharper result.' });
      statsWarn.replaceChildren(warnings(ws) || '');
      dropCrop();
      stage.fit();
    };

    const showResult = () => {
      const blob = store.assets.output;
      if (!blob) { result.replaceChildren(); return; }
      const info = store.assets.outputInfo || {};
      result.replaceChildren(
        h('p', { class: 'ok-note' }, `Ready · ${fmt.bytes(blob.size)}${info.width ? ` · ${info.width} × ${info.height} px` : ''}`),
        h('div', { class: 'btn-row' },
          button('Download interlaced.png', () => downloadBlob(blob, `${(s().name || 'card').replace(/[^\w-]+/g, '-')}-interlaced-${s().printer.ppi}ppi.png`), { kind: 'primary' })),
      );
    };

    const invalidate = () => {
      if (store.assets.output) { store.setAssets({ output: null, outputInfo: null }); result.replaceChildren(h('p', { class: 'hint' }, 'Settings changed: generate again.')); }
      refreshStats();
      stage.invalidate();
    };

    /** Print frames are missing or older than the project, and we can rebuild them. */
    const needsBuild = () => {
      const fs = store.framesStatus();
      if (!frameSource(s(), store.assets)) return false;
      return !store.assets.frames.length || (fs.stale && store.assets.framesSource !== 'imported') || (fs.stale && !store.assets.frames.length);
    };

    const build = async () => {
      if (!frameSource(s(), store.assets)) throw new Error('Nothing to build: add images in Step 3 or import frames here.');
      await buildFinalFrames((p, l) => prog.set(p, l));
      prog.done();
      invalidate();
    };

    /** Where the first and last frames differ most (that is where strips are easiest to see). */
    const busiestPoint = () => {
      const fr = store.assets.frames, N = 48;
      const grab = (f) => { const c = makeCanvas(N, N); const x = ctx2d(c, { willReadFrequently: true }); x.drawImage(f, 0, 0, N, N); return x.getImageData(0, 0, N, N).data; };
      const a = grab(fr[0]), b = grab(fr[fr.length - 1]);
      let best = -1, bi = (N * N) / 2 + N / 2;
      for (let i = 0; i < N * N; i++) {
        const d = Math.abs(a[i * 4] - b[i * 4]) + Math.abs(a[i * 4 + 1] - b[i * 4 + 1]) + Math.abs(a[i * 4 + 2] - b[i * 4 + 2]);
        if (d > best) { best = d; bi = i; }
      }
      return { u: ((bi % N) + 0.5) / N, v: (Math.floor(bi / N) + 0.5) / N };
    };

    const showStrips = () => {
      if (!store.assets.frames.length) throw new Error('No frames yet: build or import them first.');
      const r = P.cards[0];
      const { u, v } = busiestPoint();
      // 2.5 device px per printed pixel.
      stage.focus(r.x + u * r.w, r.y + v * r.h, (2.5 / stage.dpr) / mmPerPx());
    };
    tools.append(
      button('Show strips', showStrips, { kind: 'small', title: 'Zoom in to the real print pixels' }),
      button('Whole sheet', () => stage.fit(), { kind: 'small ghost' }),
    );

    inspector.append(
      section('Frames', framesNote,
        h('div', { class: 'btn-row' },
          button('Rebuild', build, { kind: 'small', title: 'Rebuild the print frames from Steps 3–5' }),
          button('Import frames…', async () => {
            const files = await pickFiles({ accept: '.zip,image/*', multiple: true });
            if (!files.length) return;
            const n = await importFrames(files);
            invalidate();
            toast(`Imported ${n} frames (sorted by file name).`);
          }, { kind: 'small ghost' }),
          button('Export frames.zip', async () => {
            if (!store.assets.frames.length) throw new Error('No frames yet.');
            downloadBlob(await exportFrames(), 'frames.zip');
          }, { kind: 'small ghost' })),
        hint('Print frames are built automatically from Steps 3–5. Own frames? Import images named frame_01.png, frame_02.png, …')),
      section('Options',
        checkbox({ label: 'Reverse frame order', checked: s().interlace.reverse, hint: 'Toggle if 3D looks inside-out.', onChange: (v) => { store.update((st) => { st.interlace.reverse = v; }); invalidate(); } }),
        checkbox({ label: 'Alignment marks', checked: s().interlace.marks, hint: 'Crop marks + lens alignment strip.', onChange: (v) => { store.update((st) => { st.interlace.marks = v; }); invalidate(); } }),
        numberField({ label: 'Marks margin', unit: 'mm', value: s().interlace.marginMm, step: 1, min: 4, max: 20, onChange: (v) => { if (v >= 4) { store.update((st) => { st.interlace.marginMm = v; }); invalidate(); } } }),
        checkbox({ label: `Tile cards on the paper (${s().media.name || `${s().media.widthMm} × ${s().media.heightMm} mm`})`, checked: s().interlace.tileOnMedia, hint: 'Copies share one lens grid.', onChange: (v) => { store.update((st) => { st.interlace.tileOnMedia = v; }); invalidate(); } }),
        slider({ label: 'Phase offset', value: s().interlace.phaseOffset, min: 0, max: 1, step: 0.05, format: (v) => `${v.toFixed(2)} lens`, onChange: (v) => { store.update((st) => { st.interlace.phaseOffset = v; }); invalidate(); } })),
      section('Generate',
        h('div', { class: 'btn-row' }, button('Generate interlaced.png', async () => {
          if (!store.assets.frames.length) throw new Error('No frames yet: build or import them first.');
          if (needsBuild()) await build();
          const t0 = performance.now();
          const r = await interlaceCurrentFrames((p) => prog.set(p, `Interlacing & encoding ${Math.round(p * 100)}%`));
          prog.done();
          store.setAssets({ output: r.blob, outputInfo: r });
          store.setStep(6, 'done');
          showResult();
          toast(`Interlaced in ${((performance.now() - t0) / 1000).toFixed(1)} s.`);
        }, { kind: 'primary' })),
        prog, result),
      section('Output', stats, statsWarn),
    );

    refreshStats();
    refreshFrames();
    showResult();
    if (needsBuild()) build().catch((e) => toast(e.message, 'error'));
    let lastFrames = store.assets.frames;
    const offs = [
      store.on('assets', () => { if (store.assets.frames !== lastFrames) { lastFrames = store.assets.frames; refreshFrames(); } }),
    ];
    return () => { offs.forEach((f) => f()); ts.destroy(); clearTimeout(cropTimer); cropToken++; };
  },
};
