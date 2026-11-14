import { h, card, row, hint, slider, button, radios, downloadBlob, pickFiles, toast, clear, progress, warnings, selectField } from '../ui.js';
import { bleedBoxPx } from '../core/geometry.js';
import { applyBrush, createDepthMap, edgeCleanup } from '../core/depthmap.js';
import { makeCanvas, ctx2d, sizeForDisplay, canvasToBlob, depthMapToCanvas, depthMapFromBlob, imageDataOf } from '../canvas.js';
import { renderBase, frameSource } from '../compose.js';
import { buildFinalFrames } from '../pipeline.js';
import { exportFrames, importFrames } from '../project-io.js';
import { planFor } from './s2-plan.js';

const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2';
const DEPTH_MODEL = 'onnx-community/depth-anything-v2-small';

let depthPipeline = null;

async function estimateDepth(srcCanvas, onProgress) {
  onProgress(0.02, 'Loading transformers.js…');
  let lib;
  try { lib = await import(TRANSFORMERS_URL); }
  catch { throw new Error('Could not load transformers.js from the CDN (offline?). You can paint or import a depth map instead.'); }
  if (!depthPipeline) {
    const files = new Map();
    depthPipeline = await lib.pipeline('depth-estimation', DEPTH_MODEL, {
      progress_callback: (p) => {
        if (p.status === 'progress' && p.total) {
          files.set(p.file, [p.loaded, p.total]);
          let l = 0, t = 0;
          for (const [a, b] of files.values()) { l += a; t += b; }
          onProgress(0.05 + 0.75 * (l / t), `Downloading model (first time only) ${Math.round(l / 1e6)}/${Math.round(t / 1e6)} MB`);
        }
      },
    });
  }
  onProgress(0.85, 'Estimating depth…');
  const url = URL.createObjectURL(await canvasToBlob(srcCanvas));
  try {
    const img = await lib.RawImage.fromURL(url);
    const out = await depthPipeline(img);
    const d = out.depth;
    const ch = d.channels || 1;
    const data = new Uint8Array(d.width * d.height);
    for (let i = 0; i < data.length; i++) data[i] = d.data[i * ch];
    return { w: d.width, h: d.height, data };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Depth map painted from layer silhouettes and their depth values. */
function depthFromLayers(state, assets, W, H) {
  const { w: outW, h: outH } = bleedBoxPx(state.card, state.printer.ppi);
  const c = makeCanvas(W, H);
  const x = ctx2d(c, { willReadFrequently: true });
  x.fillStyle = '#000';
  x.fillRect(0, 0, W, H);
  for (const l of state.layers) {
    const img = assets.layerImages[l.id];
    if (!l.visible || !img) continue;
    const g = Math.round(((l.depth + 1) / 2) * 255);
    const t = makeCanvas(W, H);
    const tx = ctx2d(t);
    tx.setTransform(W / outW, 0, 0, H / outH, 0, 0);
    const dw = l.scale * outW, dh = (dw * img.height) / img.width;
    tx.drawImage(img, l.x * outW - dw / 2, l.y * outH - dh / 2, dw, dh);
    tx.setTransform(1, 0, 0, 1, 0, 0);
    tx.globalCompositeOperation = 'source-in';
    tx.fillStyle = `rgb(${g},${g},${g})`;
    tx.fillRect(0, 0, W, H);
    x.drawImage(t, 0, 0);
  }
  const d = imageDataOf(c).data;
  const data = new Uint8Array(W * H);
  for (let i = 0; i < data.length; i++) data[i] = d[i * 4];
  return { w: W, h: H, data };
}

export default {
  id: 5,
  title: 'Depth & 3D',
  subtitle: 'Layers or AI depth',
  optional: true,
  intro: 'Optional. Give layers a depth, or estimate a depth map from a flat painting, then build the per-view frames.',
  render(root, { store, go }) {
    const s = () => store.state;
    const prog = progress();
    const b = () => bleedBoxPx(s().card, s().printer.ppi);
    const aspect = () => b().w / b().h;
    const usage = h('div');

    const refreshUsage = () => {
      const p = planFor(s());
      const ws = [];
      if (s().depth.mode !== 'none') {
        ws.push({ level: 'info', text: `Largest shift per frame: ${(p.depth?.pxPerFrame || 0).toFixed(1)} px of a ${p.maxShiftPxPerFrame.toFixed(1)} px budget · ${p.framesBetweenEyes.toFixed(2)} frames between the eyes.` });
        ws.push(...p.warnings.filter((w) => w.code === 'blur-risk' || w.code === 'weak-3d'));
        if (s().orientation === 'horizontal') ws.push({ level: 'warn', text: '3D needs vertical ridges (each eye sees a different strip). Change the ridge direction in Step 2.' });
        if (s().depth.mode === 'layers' && frameSource(s(), store.assets) === 'clip') ws.push({ level: 'error', text: 'Layer depth cannot be used with a video clip. Use AI depth.' });
      }
      usage.replaceChildren(warnings(ws) || '');
    };

    const strength = slider({
      label: 'Strength', value: s().depth.strength, min: 0, max: 2, step: 0.01, format: (v) => v.toFixed(2),
      onChange: (v) => store.update((st) => { st.depth.strength = v; }),
    });
    const keyPlane = slider({
      label: 'Key plane (depth that stays still, sharpest)', value: s().depth.keyPlane, min: -1, max: 1, step: 0.05, format: (v) => v.toFixed(2),
      onChange: (v) => store.update((st) => { st.depth.keyPlane = v; }),
    });
    const fitBudget = button('Fit strength to budget', () => {
      const st = s();
      let maxAbs;
      if (st.depth.mode === 'layers') maxAbs = Math.max(0, ...st.layers.filter((l) => l.visible).map((l) => Math.abs(l.depth - st.depth.keyPlane)));
      else maxAbs = Math.max(Math.abs(1 - st.depth.keyPlane), Math.abs(-1 - st.depth.keyPlane));
      if (!maxAbs) return;
      const v = +(1 / maxAbs).toFixed(2);
      store.update((x) => { x.depth.strength = v; });
      strength.set(v);
    }, { kind: 'small' });

    // ---------- layers mode ----------
    const layersBox = h('div');
    const renderLayers = () => {
      clear(layersBox);
      if (!s().layers.length) { layersBox.append(hint('No layers. Add them in Step 3.')); return; }
      [...s().layers].reverse().forEach((l) => {
        layersBox.append(slider({
          label: l.name, value: l.depth, min: -1, max: 1, step: 0.05,
          format: (v) => (v < 0 ? `${v.toFixed(2)} far` : v > 0 ? `+${v.toFixed(2)} near` : '0'),
          onChange: (v) => store.update((st) => { st.layers.find((x) => x.id === l.id).depth = v; }),
        }));
      });
    };
    const layersPanel = card('Layer depths',
      hint('Back layers far (−), front layers near (+). Shift per frame = (depth − key plane) × strength × budget.'),
      layersBox,
      h('div', { class: 'btn-row' }, button('Spread evenly (back −1 → front +1)', () => {
        store.update((st) => {
          const n = st.layers.length;
          st.layers.forEach((l, i) => { l.depth = n === 1 ? 0 : +(-1 + (2 * i) / (n - 1)).toFixed(2); });
        });
        renderLayers();
      }, { kind: 'small' })),
    );

    // ---------- AI / depth map mode ----------
    const dcanvas = h('canvas', { 'aria-label': 'Depth map editor. Paint to adjust depth.' });
    const dstage = h('div', { class: 'stage crosshair' }, dcanvas);
    let view = 'depth', tool = 'near', brushR = 30, brushS = 0.5;
    let baseImg = null;
    const getBase = () => {
      if (baseImg) return baseImg;
      const st = s();
      const k = 768 / Math.max(b().w, b().h);
      const c = makeCanvas(b().w * k, b().h * k);
      if (frameSource(st, store.assets)) renderBase(c, st, store.assets, Math.floor(st.plan.frames / 2), st.plan.frames);
      baseImg = c;
      return c;
    };
    const drawDepth = () => {
      sizeForDisplay(dcanvas, aspect(), Math.min(560, (dstage.clientWidth || 560) - 24), 560);
      const x = ctx2d(dcanvas);
      x.clearRect(0, 0, dcanvas.width, dcanvas.height);
      const m = store.assets.depthMap;
      if (view !== 'depth' || !m) x.drawImage(getBase(), 0, 0, dcanvas.width, dcanvas.height);
      if (m) {
        x.globalAlpha = view === 'overlay' ? 0.55 : view === 'image' ? 0 : 1;
        x.drawImage(depthMapToCanvas(m), 0, 0, dcanvas.width, dcanvas.height);
        x.globalAlpha = 1;
      }
    };
    let painting = false;
    const dab = (e) => {
      const m = store.assets.depthMap;
      if (!m) return;
      const r = dcanvas.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * m.w, py = ((e.clientY - r.top) / r.height) * m.h;
      applyBrush(m, px, py, (brushR / r.width) * m.w, brushS, tool);
      drawDepth();
    };
    dcanvas.addEventListener('pointerdown', (e) => { if (!store.assets.depthMap) return; painting = true; dcanvas.setPointerCapture(e.pointerId); dab(e); });
    dcanvas.addEventListener('pointermove', (e) => { if (painting) dab(e); });
    const endPaint = () => { if (painting) { painting = false; store.dirty = true; } };
    dcanvas.addEventListener('pointerup', endPaint);
    dcanvas.addEventListener('pointercancel', endPaint);

    const setMap = (m) => { store.setAssets({ depthMap: m }); drawDepth(); };
    const mapSize = () => { const k = 1024 / Math.max(b().w, b().h); return [Math.round(b().w * k), Math.round(b().h * k)]; };

    let dil = 2, blr = 2;
    const aiPanel = card('Depth map',
      hint('White = near, black = far. Estimate it with AI (Depth Anything, runs in your browser), start from your layers, or import one. Then paint corrections.'),
      h('div', { class: 'btn-row' },
        button('Estimate with AI', async () => {
          if (!frameSource(s(), store.assets)) throw new Error('Add an image in Step 3 (or a clip in Step 4) first.');
          baseImg = null;
          const m = await estimateDepth(getBase(), (p, l) => prog.set(p, l));
          prog.done();
          setMap(m);
          toast('Depth map ready. Paint to refine.');
        }, { kind: 'primary' }),
        button('From layers', () => { const [w, hh] = mapSize(); setMap(depthFromLayers(s(), store.assets, w, hh)); }),
        button('Flat (grey)', () => { const [w, hh] = mapSize(); setMap(createDepthMap(w, hh, 128)); }),
        button('Import depth.png…', async () => {
          const [f] = await pickFiles({ accept: 'image/*' });
          if (f) setMap(await depthMapFromBlob(f, 2048));
        }, { kind: 'ghost' }),
        button('Export depth.png', async () => {
          if (!store.assets.depthMap) throw new Error('No depth map yet.');
          downloadBlob(await canvasToBlob(depthMapToCanvas(store.assets.depthMap)), 'depth.png');
        }, { kind: 'ghost' }),
      ),
      dstage,
      row(
        selectField({ label: 'View', value: view, options: [['depth', 'Depth'], ['overlay', 'Image + depth'], ['image', 'Image']], onChange: (v) => { view = v; drawDepth(); } }),
        selectField({ label: 'Brush', value: tool, options: [['near', 'Nearer (+)'], ['far', 'Farther (−)'], ['smooth', 'Smooth']], onChange: (v) => { tool = v; } }),
      ),
      row(
        slider({ label: 'Brush size', value: brushR, min: 4, max: 120, step: 1, format: (v) => `${v}px`, onInput: (v) => { brushR = v; } }),
        slider({ label: 'Brush strength', value: brushS, min: 0.05, max: 1, step: 0.05, format: (v) => v.toFixed(2), onInput: (v) => { brushS = v; } }),
      ),
      h('h4', {}, 'Edge cleanup'),
      hint('Grows near regions slightly then smooths, so foreground edges carry their own halo instead of tearing.'),
      row(
        slider({ label: 'Grow', value: dil, min: 0, max: 12, step: 1, format: (v) => `${v}px`, onInput: (v) => { dil = v; } }),
        slider({ label: 'Smooth', value: blr, min: 0, max: 12, step: 1, format: (v) => `${v}px`, onInput: (v) => { blr = v; } }),
      ),
      h('div', { class: 'btn-row' }, button('Apply cleanup', () => {
        if (!store.assets.depthMap) throw new Error('No depth map yet.');
        edgeCleanup(store.assets.depthMap, { dilateRadius: dil, blurRadius: blr });
        store.dirty = true;
        drawDepth();
      }, { kind: 'small' })),
    );

    // ---------- previews ----------
    const wig = h('canvas', { 'aria-label': 'Wiggle preview' });
    const ana = h('canvas', { 'aria-label': 'Red/cyan anaglyph preview' });
    let wi = 0, wdir = 1, wtimer = 0;
    const framesNote = h('p', { class: 'hint' });
    const drawPreviews = () => {
      const fr = store.assets.frames;
      sizeForDisplay(wig, aspect(), 300, 340);
      sizeForDisplay(ana, aspect(), 300, 340);
      framesNote.textContent = store.framesStatus().text;
      if (!fr.length) {
        for (const c of [wig, ana]) { const x = ctx2d(c); x.fillStyle = '#ddd'; x.fillRect(0, 0, c.width, c.height); }
        return;
      }
      const p = planFor(s());
      const c = (fr.length - 1) / 2, half = Math.max(0.5, p.framesBetweenEyes / 2);
      const L = Math.max(0, Math.min(fr.length - 1, Math.round(c - half)));
      const R = Math.max(0, Math.min(fr.length - 1, Math.round(c + half)));
      const grab = (f) => { const t = makeCanvas(ana.width, ana.height); ctx2d(t).drawImage(f, 0, 0, t.width, t.height); return imageDataOf(t); };
      const a = grab(fr[L]), bb = grab(fr[R]);
      for (let i = 0; i < a.data.length; i += 4) {
        a.data[i + 1] = bb.data[i + 1];
        a.data[i + 2] = bb.data[i + 2];
      }
      ctx2d(ana).putImageData(a, 0, 0);
    };
    const wiggle = () => {
      clearTimeout(wtimer);
      const fr = store.assets.frames;
      if (fr.length > 1) {
        wi += wdir;
        if (wi >= fr.length - 1 || wi <= 0) { wi = Math.max(0, Math.min(fr.length - 1, wi)); wdir = -wdir; }
        ctx2d(wig).drawImage(fr[wi], 0, 0, wig.width, wig.height);
      }
      wtimer = setTimeout(wiggle, 110);
    };

    // ---------- assemble ----------
    const panels = h('div');
    const showPanels = () => {
      const m = s().depth.mode;
      panels.replaceChildren(m === 'layers' ? layersPanel : m === 'ai' ? aiPanel : card(null, hint('No depth: frames are flat (animation only).')));
      if (m === 'ai') { baseImg = null; requestAnimationFrame(drawDepth); }
      refreshUsage();
    };

    root.append(
      card('Mode', radios({
        name: 'depth-mode', value: s().depth.mode,
        options: [['none', 'None'], ['layers', 'Layers'], ['ai', 'Depth map (AI / painted)']],
        onChange: (v) => { store.update((st) => { st.depth.mode = v; }); showPanels(); },
      })),
      h('div', { class: 'cols-wide' },
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '18px' } },
          panels,
        ),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '18px' } },
          card('Depth settings', keyPlane, strength, h('div', { class: 'btn-row' }, fitBudget), usage),
          card('Build frames',
            hint('Renders every view at working resolution (combining motion from Step 4 when present).'),
            h('div', { class: 'btn-row' },
              button('Build frames', async () => {
                await buildFinalFrames((p, l) => prog.set(p, l));
                prog.done();
                store.setStep(5, 'done');
                drawPreviews();
                toast('Frames built.');
              }, { kind: 'primary' }),
              button('Go to interlace →', () => go(6), { kind: 'ghost' })),
            prog,
            h('div', { class: 'row', style: { alignItems: 'flex-start', marginTop: '10px' } },
              h('figure', { style: { margin: 0 } }, h('div', { class: 'stage' }, wig), h('figcaption', { class: 'hint' }, 'Wiggle')),
              h('figure', { style: { margin: 0 } }, h('div', { class: 'stage' }, ana), h('figcaption', { class: 'hint' }, 'Red/cyan anaglyph'))),
            framesNote,
            h('h4', {}, 'Import / export'),
            h('div', { class: 'btn-row' },
              button('Export frames.zip', async () => {
                if (!store.assets.frames.length) throw new Error('No frames yet.');
                downloadBlob(await exportFrames(), 'frames.zip');
              }),
              button('Import frames…', async () => {
                const files = await pickFiles({ accept: '.zip,image/*', multiple: true });
                if (!files.length) return;
                const n = await importFrames(files);
                drawPreviews();
                toast(`Imported ${n} frames.`);
              }, { kind: 'ghost' })),
          ),
        ),
      ),
    );
    showPanels();
    renderLayers();
    drawPreviews();
    wiggle();
    const offs = [store.on('change', refreshUsage), store.on('assets', () => { framesNote.textContent = store.framesStatus().text; })];
    return () => { clearTimeout(wtimer); offs.forEach((f) => f()); };
  },
};
