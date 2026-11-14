import { h, card, row, hint, tip, pic, numberField, slider, checkbox, button, downloadBlob, pickFiles, toast, clear, progress, stat, fmt, warnings } from '../ui.js';
import { bleedBoxPx, frameGeometry, lpiInUse, mmToPx, pxToMm, tileLayout } from '../core/geometry.js';
import { visibleFrameAtAngle } from '../core/interlace.js';
import { makeCanvas, ctx2d, sizeForDisplay } from '../canvas.js';
import { frameSource } from '../compose.js';
import { buildFinalFrames, interlaceCurrentFrames, previewCrop } from '../pipeline.js';
import { importFrames } from '../project-io.js';
import { planFor } from './s2-plan.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };

function lensDiagram(n, visible, reverse, angleDeg, viewDeg) {
  const W = 360, H = 170, x0 = 60, lw = 240, base = 140;
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'lens-diagram', role: 'img', 'aria-label': `Lens cross-section: strip ${visible + 1} of ${n} visible` });
  // strips under the lens (printed order)
  for (let p = 0; p < n; p++) {
    const k = reverse ? n - 1 - p : p;
    const on = k === visible;
    root.append(svg('rect', { x: x0 + (p * lw) / n, y: base, width: lw / n - 1, height: 18, fill: on ? 'var(--primary)' : 'var(--panel-2)', stroke: 'var(--line)' }));
    const t = svg('text', { x: x0 + ((p + 0.5) * lw) / n, y: base + 13, 'text-anchor': 'middle', 'font-size': 10, fill: on ? 'var(--primary-text)' : 'var(--muted)' });
    t.textContent = k + 1;
    root.append(t);
  }
  // lens profile
  root.append(svg('path', { d: `M${x0} ${base} Q ${x0 + lw / 2} ${base - 110} ${x0 + lw} ${base} Z`, fill: 'color-mix(in srgb, var(--primary) 12%, transparent)', stroke: 'var(--primary)', 'stroke-width': 1.5 }));
  // viewing ray
  const cx = x0 + lw / 2, cy = base - 55;
  const a = (angleDeg * Math.PI) / 180;
  root.append(svg('line', { x1: cx, y1: cy, x2: cx + Math.sin(a) * 90, y2: cy - Math.cos(a) * 90, stroke: 'var(--warn)', 'stroke-width': 2, 'stroke-dasharray': '4 3' }));
  const lbl = svg('text', { x: 8, y: 16, 'font-size': 12, fill: 'var(--muted)' });
  lbl.textContent = `tilt ${angleDeg.toFixed(1)}° of ±${(viewDeg / 2).toFixed(1)}°`;
  root.append(lbl);
  return root;
}

export default {
  id: 6,
  title: 'Slice & interlace',
  subtitle: 'Make the print file',
  intro: 'Slice the frames into strips that fit your lens exactly.',
  details: [
    'The PNG carries its print resolution, so it prints at true size from an app that respects it.',
    'Registration strip: outside the card, one strip per lens is black. With the lens aligned, the whole strip goes dark at once as you tilt; diagonal bands mean the lens is rotated.',
    'Bring your own frames: name them so they sort in viewing order (frame_01.png, frame_02.png, …). They are cover-fitted to the card.',
  ],
  render(root, { store }) {
    const s = () => store.state;
    const prog = progress();
    const stats = h('div', { class: 'stats' });
    const statsWarn = h('div', { style: { marginTop: '12px' } });
    const framesBox = h('div');
    const result = h('div');
    const zoom = h('canvas', { style: { imageRendering: 'pixelated', width: '100%', maxWidth: '640px' }, 'aria-label': 'Zoomed 1:1 crop of interlaced output' });
    const zoomStage = h('div', { class: 'stage', hidden: true }, zoom);

    const refreshStats = () => {
      const st = s();
      const b = bleedBoxPx(st.card, st.printer.ppi);
      const ppi = st.printer.ppi;
      const m = st.interlace.marks ? Math.round(mmToPx(st.interlace.marginMm, ppi)) : 0;
      let page = { w: b.w + 2 * m, h: b.h + 2 * m }, cards = 1;
      if (st.interlace.tileOnMedia) {
        const t = tileLayout(b.w + 2 * m, b.h + 2 * m, ppi, st.media);
        page = { w: t.pageW, h: t.pageH }; cards = t.cols * t.rows;
      }
      stats.replaceChildren(
        stat('Print size', `${fmt.n(pxToMm(page.w, ppi), 1)} × ${fmt.n(pxToMm(page.h, ppi), 1)} mm`),
        stat('Pixels', `${page.w} × ${page.h}`),
        stat('Resolution', `${ppi} ppi`),
        stat('Pitch', `${fmt.n(ppi / lpiInUse(st.lens), 4)} px @ ${fmt.n(lpiInUse(st.lens), 2)} LPI`),
        stat('Frames', st.plan.frames),
        stat('Ridges', st.orientation),
        ...(st.interlace.tileOnMedia ? [stat(`Cards per ${st.media.name || 'sheet'}`, cards)] : []),
      );
      const ws = [];
      if (st.interlace.tileOnMedia && cards < 1) ws.push({ level: 'error', text: `The card (with marks) does not fit on ${st.media.name || 'the paper'}. Choose larger paper in Step 1 or turn off tiling.` });
      if (!st.lens.lpiMeasured) ws.push({ level: 'info', text: 'Using nominal LPI. Run the pitch test (Step 1) for a sharper result.' });
      statsWarn.replaceChildren(warnings(ws) || '');
    };

    const thumbs = h('div', { class: 'thumbs' });
    const refreshFrames = () => {
      const fs = store.framesStatus();
      clear(thumbs);
      const g = frameGeometry(s());
      const aspect = g.outW / g.outH;
      store.assets.frames.forEach((f, i) => {
        const t = makeCanvas(Math.round(72 * aspect), 72);
        ctx2d(t).drawImage(f, 0, 0, t.width, t.height);
        t.title = `Frame ${i + 1}`;
        thumbs.append(t);
      });
      framesBox.replaceChildren(
        h('p', { class: fs.ok ? 'ok-note' : 'hint' }, fs.text, store.assets.framesSource ? ` · ${store.assets.framesSource}` : ''),
        thumbs,
      );
      drawTilt();
    };

    // ---------- tilt simulator ----------
    const tiltCanvas = h('canvas', { 'aria-label': 'Tilt simulator view' });
    const diagram = h('div');
    const tiltLabel = h('p', { class: 'hint' });
    let tilt = 0;
    const viewDeg = () => planFor(s()).viewingAngleDeg;
    const drawTilt = () => {
      const fr = store.assets.frames;
      const g = frameGeometry(s());
      sizeForDisplay(tiltCanvas, g.outW / g.outH, 300, 340);
      const x = ctx2d(tiltCanvas);
      const n = fr.length || s().plan.frames;
      const k = visibleFrameAtAngle(tilt, viewDeg(), n);
      if (fr[k]) x.drawImage(fr[k], 0, 0, tiltCanvas.width, tiltCanvas.height);
      else { x.fillStyle = '#ddd'; x.fillRect(0, 0, tiltCanvas.width, tiltCanvas.height); }
      diagram.replaceChildren(lensDiagram(n, k, s().interlace.reverse, tilt, viewDeg()));
      tiltLabel.textContent = `Frame ${k + 1} of ${n} visible. ${s().orientation === 'vertical' ? 'Turn the card left/right.' : 'Tilt the card toward / away from you.'}`;
    };
    const tiltSlider = slider({
      label: 'Tilt', value: 0, min: -30, max: 30, step: 0.25, format: (v) => `${v.toFixed(1)}°`,
      onInput: (v) => { tilt = v; drawTilt(); },
    });

    let lastUrl = null;
    const showResult = (r) => {
      const blob = store.assets.output;
      if (!blob) { result.replaceChildren(); return; }
      if (lastUrl) URL.revokeObjectURL(lastUrl);
      const info = store.assets.outputInfo || r || {};
      result.replaceChildren(
        h('p', { class: 'ok-note' }, `interlaced.png ready · ${fmt.bytes(blob.size)}${info.width ? ` · ${info.width} × ${info.height} px` : ''}${info.placements > 1 ? ` · ${info.placements} cards` : ''}`),
        h('div', { class: 'btn-row' },
          button('Download interlaced.png', () => downloadBlob(blob, `${(s().name || 'card').replace(/[^\w-]+/g, '-')}-interlaced-${s().printer.ppi}ppi.png`), { kind: 'primary' }),
          button('Zoom preview (1:1 crop)', zoomPreview)),
      );
    };

    const zoomPreview = async () => {
      if (!store.assets.frames.length) throw new Error('No frames.');
      const b = bleedBoxPx(s().card, s().printer.ppi);
      const m = s().interlace.marks ? Math.round(mmToPx(s().interlace.marginMm, s().printer.ppi)) : 0;
      // Centre on the top-left trim corner: crop marks, registration strip and image in one view.
      const w = 360, hh = 360;
      const cx = m + b.bleedPx, cy = m + b.bleedPx;
      const r = await previewCrop(cx - w * 0.45, cy - hh * 0.55, w, hh);
      zoom.width = r.w; zoom.height = r.h;
      ctx2d(zoom).putImageData(new ImageData(new Uint8ClampedArray(r.buffer), r.w, r.h), 0, 0);
      zoomStage.hidden = false;
    };

    const opts = card('Options',
      pic('marks', 'Marks', 'Crop marks + lens alignment strip'),
      checkbox({ label: 'Reverse frame order', checked: s().interlace.reverse, hint: 'Toggle if 3D looks inside-out.', onChange: (v) => { store.update((st) => { st.interlace.reverse = v; }); invalidate(); drawTilt(); } }),
      checkbox({ label: 'Alignment marks', checked: s().interlace.marks, hint: 'Crop marks + lens alignment strip.', onChange: (v) => { store.update((st) => { st.interlace.marks = v; }); invalidate(); } }),
      numberField({ label: 'Marks margin', unit: 'mm', value: s().interlace.marginMm, step: 1, min: 4, max: 20, onChange: (v) => { if (v >= 4) { store.update((st) => { st.interlace.marginMm = v; }); invalidate(); } } }),
      checkbox({ label: `Tile cards on the paper (${s().media.name || `${s().media.widthMm} × ${s().media.heightMm} mm`})`, checked: s().interlace.tileOnMedia, hint: 'Copies share one lens grid.', onChange: (v) => { store.update((st) => { st.interlace.tileOnMedia = v; }); invalidate(); } }),
      slider({ label: 'Phase offset', value: s().interlace.phaseOffset, min: 0, max: 1, step: 0.05, format: (v) => `${v.toFixed(2)} lens`, onChange: (v) => { store.update((st) => { st.interlace.phaseOffset = v; }); invalidate(); } }),
    );

    const invalidate = () => {
      if (store.assets.output) { store.setAssets({ output: null, outputInfo: null }); result.replaceChildren(h('p', { class: 'hint' }, 'Settings changed: generate again.')); }
      zoomStage.hidden = true;
      refreshStats();
    };

    root.append(
      card('Output', stats, statsWarn),
      h('div', { class: 'cols-wide' },
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '18px' } },
          card('Frames',
            framesBox,
            h('div', { class: 'btn-row' },
              button('Build from Steps 3–5', async () => {
                if (!frameSource(s(), store.assets)) throw new Error('Nothing to build: add images in Step 3 or import frames here.');
                await buildFinalFrames((p, l) => prog.set(p, l));
                prog.done();
                invalidate();
              }),
              button('Import frames (images or frames.zip)…', async () => {
                const files = await pickFiles({ accept: '.zip,image/*', multiple: true });
                if (!files.length) return;
                const n = await importFrames(files);
                invalidate();
                toast(`Imported ${n} frames (sorted by file name).`);
              }, { kind: 'ghost' })),
            hint('Own frames? Name them frame_01.png, frame_02.png, …'),
          ),
          card('Generate',
            pic('interlace', 'Interlace', 'Frames become strips under each lens'),
            h('div', { class: 'btn-row' }, button('Generate interlaced.png', async () => {
              if (!store.assets.frames.length) throw new Error('No frames yet: build or import them first.');
              if (store.framesStatus().stale) {
                if (frameSource(s(), store.assets) && store.assets.framesSource === 'built' && confirm('Frames are out of date for the current settings. Rebuild them first?')) {
                  await buildFinalFrames((p, l) => prog.set(p, l));
                }
              }
              const t0 = performance.now();
              const r = await interlaceCurrentFrames((p) => prog.set(p, `Interlacing & encoding ${Math.round(p * 100)}%`));
              prog.done();
              store.setAssets({ output: r.blob, outputInfo: r });
              store.setStep(6, 'done');
              showResult(r);
              toast(`Interlaced in ${((performance.now() - t0) / 1000).toFixed(1)} s.`);
            }, { kind: 'primary' })),
            prog,
            result,
            zoomStage,
          ),
        ),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '18px' } },
          opts,
          card('Tilt simulator',
            h('div', { class: 'stage' }, tiltCanvas),
            tiltSlider, diagram, tiltLabel),
        ),
      ),
    );
    refreshStats();
    refreshFrames();
    showResult();
    const offs = [store.on('assets', refreshFrames), store.on('change', refreshStats)];
    return () => { offs.forEach((f) => f()); if (lastUrl) URL.revokeObjectURL(lastUrl); };
  },
};
