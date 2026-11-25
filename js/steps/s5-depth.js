import { h, row, hint, tip, more, section, slider, button, radios, selectField, checkbox, downloadBlob, pickFiles, toast, clear, progress, warnings } from '../ui.js';
import { bleedBoxPx } from '../core/geometry.js';
import { applyBrush, createDepthMap, edgeCleanup, temporalSmooth } from '../core/depthmap.js';
import { makeCanvas, ctx2d, canvasToBlob, depthMapToCanvas, depthMapFromBlob, imageDataOf } from '../canvas.js';
import { renderBase, frameSource, perFrameDepth } from '../compose.js';
import { estimateDepth, depthFromLayers } from '../depth-tools.js';
import { paperLayout, drawCardOnPaper, drawLensWidget, inflate, inRect } from '../scene.js';
import { createLivePreview } from '../preview.js';
import { mountTiltStrip } from '../tiltstrip.js';
import { planFor } from './s2-plan.js';

const VIEWS = [['result', 'Result (tilt to see 3D)'], ['overlay', 'Image + depth'], ['depth', 'Depth only'], ['anaglyph', 'Red / cyan glasses']];

export default {
  id: 5,
  title: 'Depth & 3D',
  subtitle: 'Layers or depth map',
  optional: true,
  intro: 'Optional. Add depth and watch it on the canvas: press Play or drag Tilt.',
  details: [
    'Key plane: the depth that stays still and sharpest, usually the main subject. Things nearer pop out of the card; farther ones sink behind it.',
    'Strength scales the effect. Keep the largest shift within the depth budget (Step 2), or the print blurs. "Fit strength to budget" sets the maximum safe value.',
    'Depth map: white is near, black is far. Switch the view to "Image + depth" and paint with the brush to correct it.',
    'The AI depth model runs in your browser. It downloads once (about 25 MB) and is then cached.',
  ],
  editor({ store, stage, inspector, tools, strip }) {
    const s = () => store.state;
    const prog = progress();
    let L = paperLayout(s());
    const preview = createLivePreview(store);
    let view = s().depth.mode === 'ai' ? 'overlay' : 'result';
    let tool = 'near', brushPct = 6, brushS = 0.5;
    let hoverPt = null;
    // Depth per clip frame: which clip frame the map view and brush work on.
    const clipCount = () => store.assets.animFrames.length;
    let editIdx = Math.max(0, Math.floor((clipCount() - 1) / 2));
    let brushAll = false, smoothTime = true;
    const perFrame = () => perFrameDepth(s(), store.assets);
    const curMap = () => (perFrame() ? store.assets.clipDepthMaps[editIdx] || null : store.assets.depthMap);

    // ---------- cached pictures ----------
    const memo = (make) => { let key = null, val = null; return () => { const k = `${store.inputSig()}|${perFrame() ? editIdx : ''}`; if (k !== key) { val = make(); key = k; } return val; }; };
    /** A source picture at preview size: the clip frame being edited, or the middle frame. */
    const sourceImage = (idx = null) => {
      if (!frameSource(s(), store.assets)) return null;
      const b = bleedBoxPx(s().card, s().printer.ppi), k = 640 / Math.max(b.w, b.h);
      const c = makeCanvas(b.w * k, b.h * k);
      if (idx != null) { ctx2d(c).drawImage(store.assets.animFrames[idx], 0, 0, c.width, c.height); return c; }
      return renderBase(c, s(), store.assets, Math.floor(s().plan.frames / 2), s().plan.frames);
    };
    const baseImage = memo(() => sourceImage(perFrame() ? editIdx : null));
    const mapSize = () => { const b = bleedBoxPx(s().card, s().printer.ppi), k = 1024 / Math.max(b.w, b.h); return [Math.round(b.w * k), Math.round(b.h * k)]; };
    let depthCanvas = null, depthKey = null;
    const depthImage = () => {
      const k = `${store.inputSig()}|${perFrame() ? editIdx : ''}`;
      if (k !== depthKey) {
        const m = s().depth.mode === 'ai' ? curMap() : (s().layers.length ? depthFromLayers(s(), store.assets, ...mapSize().map((v) => Math.round(v / 3))) : null);
        depthCanvas = m ? depthMapToCanvas(m) : null;
        depthKey = k;
      }
      return depthCanvas;
    };
    const anaglyph = memo(() => {
      const fr = preview.frames();
      if (fr.length < 2) return fr[0] || null;
      const p = planFor(s()), c = (fr.length - 1) / 2, half = Math.max(0.5, p.framesBetweenEyes / 2);
      const pick = (i) => fr[Math.max(0, Math.min(fr.length - 1, Math.round(i)))];
      const a = imageDataOf(pick(c - half)), b = imageDataOf(pick(c + half));
      for (let i = 0; i < a.data.length; i += 4) { a.data[i + 1] = b.data[i + 1]; a.data[i + 2] = b.data[i + 2]; }
      const out = makeCanvas(a.width, a.height);
      ctx2d(out).putImageData(a, 0, 0);
      return out;
    });

    const canBrush = () => s().depth.mode === 'ai' && curMap() && (view === 'overlay' || view === 'depth');
    const brushMm = () => (brushPct / 100) * L.card.w;

    const ts = mountTiltStrip(strip, {
      frames: () => (s().depth.mode === 'none' && s().animation.mode === 'none' ? [] : preview.frames()),
      viewDeg: () => planFor(s()).viewingAngleDeg,
      onChange: () => { if (ts.active && view !== 'result') setView('result'); stage.invalidate(); },
    });

    // ---------- side view of the layer depths (drag the dots) ----------
    let dv = null; // geometry of the last drawn panel, in world units
    const snap = (d) => Math.max(-1, Math.min(1, Math.round(d / 0.05) * 0.05));
    const drawDepthView = (ctx, v) => {
      const layers = [...s().layers].reverse().filter((l) => l.visible);
      if (!layers.length) { dv = null; return; }
      const px = v.px, c = v.colors;
      const W = 250 * px, rowH = 22 * px, H = (44 + layers.length * 22) * px;
      const x0 = v.visible.x + v.visible.w - W - 12 * px, y0 = v.visible.y + 12 * px;
      const tx0 = x0 + 92 * px, tw = W - 92 * px - 16 * px, rowsY0 = y0 + 34 * px;
      const xOf = (d) => tx0 + ((d + 1) / 2) * tw;
      dv = { x0, y0, W, H, tx0, tw, rowH, rowsY0, layers, px, xOf };
      ctx.save();
      ctx.globalAlpha = 0.95; ctx.fillStyle = c.panel;
      ctx.beginPath(); ctx.roundRect(x0, y0, W, H, 8 * px); ctx.fill();
      ctx.globalAlpha = 1; ctx.lineWidth = px; ctx.strokeStyle = c.line; ctx.stroke();
      layers.forEach((l, i) => {
        const y = rowsY0 + (i + 0.5) * rowH;
        ctx.beginPath(); ctx.moveTo(tx0, y); ctx.lineTo(tx0 + tw, y); ctx.strokeStyle = c.line; ctx.lineWidth = 2 * px; ctx.stroke();
        ctx.beginPath(); ctx.arc(xOf(l.depth), y, 6.5 * px, 0, Math.PI * 2);
        ctx.fillStyle = c.primary; ctx.fill(); ctx.lineWidth = 2 * px; ctx.strokeStyle = '#fff'; ctx.stroke();
      });
      const kx = xOf(s().depth.keyPlane);
      ctx.beginPath(); ctx.setLineDash([4 * px, 3 * px]); ctx.moveTo(kx, y0 + 24 * px); ctx.lineTo(kx, y0 + H - 6 * px);
      ctx.strokeStyle = c.warn; ctx.lineWidth = 1.5 * px; ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(kx - 6 * px, y0 + 20 * px); ctx.lineTo(kx + 6 * px, y0 + 20 * px); ctx.lineTo(kx, y0 + 29 * px); ctx.closePath();
      ctx.fillStyle = c.warn; ctx.fill();
      ctx.restore();
      v.text('far', tx0, y0, { dy: 15, size: 10 });
      v.text('near', tx0 + tw, y0, { dy: 15, size: 10, align: 'right' });
      v.text('key', kx, y0, { dy: 15, size: 10, align: 'center', color: c.warn, bold: true });
      layers.forEach((l, i) => v.text(l.name.length > 11 ? `${l.name.slice(0, 10)}…` : l.name, x0 + 10 * px, rowsY0 + (i + 0.5) * rowH, { baseline: 'middle', color: c.text }));
    };
    const inDepthView = (pt) => dv && pt.x >= dv.x0 && pt.x <= dv.x0 + dv.W && pt.y >= dv.y0 && pt.y <= dv.y0 + dv.H;
    const depthViewDown = (pt) => {
      if (!inDepthView(pt)) return null;
      const dAt = (p) => snap(((p.x - dv.tx0) / dv.tw) * 2 - 1);
      const done = () => { store.update(() => {}); renderLayers(); keyPlane.set(s().depth.keyPlane); };
      if (pt.y < dv.rowsY0) {
        if (Math.abs(pt.x - dv.xOf(s().depth.keyPlane)) > 12 * dv.px) return {};
        return { move: (p) => { s().depth.keyPlane = dAt(p); }, up: done };
      }
      const l = dv.layers[Math.floor((pt.y - dv.rowsY0) / dv.rowH)];
      if (!l) return {};
      l.depth = dAt(pt);
      return { move: (p) => { l.depth = dAt(p); }, up: done };
    };

    stage.setScene({
      bounds: () => inflate(L.card, 12),
      draw(ctx, v) {
        const fr = preview.frames();
        let image = null;
        if (view === 'result') image = fr[ts.index()] || fr[0] || baseImage();
        else if (view === 'anaglyph') image = anaglyph();
        else if (view === 'depth') image = depthImage() || baseImage();
        else image = baseImage();
        drawCardOnPaper(ctx, v, L, s(), { image, dimPaper: true, emptyText: 'Add an image in Step 3 first' });
        if (view === 'overlay' && depthImage()) {
          ctx.save();
          ctx.globalAlpha = 0.55;
          ctx.drawImage(depthImage(), L.card.x, L.card.y, L.card.w, L.card.h);
          ctx.restore();
        }
        if (canBrush() && hoverPt && inRect(hoverPt, L.card)) {
          ctx.save();
          ctx.beginPath(); ctx.arc(hoverPt.x, hoverPt.y, brushMm(), 0, Math.PI * 2);
          ctx.lineWidth = 2.5 * v.px; ctx.strokeStyle = '#000'; ctx.stroke();
          ctx.lineWidth = 1 * v.px; ctx.strokeStyle = '#fff'; ctx.stroke();
          ctx.restore();
        }
        if (v.guides) {
          if (view === 'depth' || view === 'overlay') v.text('white = near · black = far', L.card.x + L.card.w / 2, L.card.y + L.card.h, { align: 'center', dy: 16, bold: true, color: v.colors.text });
          if (view === 'anaglyph') v.text('view with red / cyan glasses', L.card.x + L.card.w / 2, L.card.y + L.card.h, { align: 'center', dy: 16, bold: true, color: v.colors.text });
          if (s().depth.mode === 'layers') drawDepthView(ctx, v); else dv = null;
          if (fr.length > 1 && s().depth.mode !== 'none') drawLensWidget(ctx, v, { n: fr.length, active: [ts.index()], reverse: false, label: `Frame ${ts.index() + 1} of ${fr.length}` });
        }
      },
      hover(pt) { hoverPt = pt; if (inDepthView(pt)) return 'ew-resize'; if (canBrush()) { stage.invalidate(); return inRect(pt, L.card) ? 'crosshair' : 'grab'; } return 'grab'; },
      pointerDown(pt) {
        const hit = stage.guides && s().depth.mode === 'layers' ? depthViewDown(pt) : null;
        if (hit) return hit;
        if (!canBrush() || !inRect(pt, L.card)) return null;
        const m = curMap();
        // "Brush all frames" paints the same stroke into every clip frame's map.
        const maps = perFrame() && brushAll ? store.assets.clipDepthMaps.filter(Boolean) : [m];
        const dab = (p) => {
          hoverPt = p;
          for (const t of maps) applyBrush(t, ((p.x - L.card.x) / L.card.w) * t.w, ((p.y - L.card.y) / L.card.h) * t.h, (brushMm() / L.card.w) * t.w, brushS, tool);
          depthCanvas = depthMapToCanvas(m);
        };
        const before = maps.map((t) => t.data.slice());
        dab(pt);
        return {
          move: dab,
          up: () => {
            const after = maps.map((t) => t.data.slice());
            store.recordAction({
              undo: () => { maps.forEach((t, i) => t.data.set(before[i])); store.touchAssets(); },
              redo: () => { maps.forEach((t, i) => t.data.set(after[i])); store.touchAssets(); },
            });
            store.touchAssets();
          },
        };
      },
    });

    // ---------- toolbar ----------
    const viewSel = selectField({ label: 'View', value: view, options: VIEWS, onChange: (v) => setView(v) });
    const brushTools = h('div', { class: 'stage-tools' },
      selectField({ label: 'Brush', value: tool, options: [['near', 'Nearer (+)'], ['far', 'Farther (−)'], ['smooth', 'Smooth']], onChange: (v) => { tool = v; } }),
      slider({ label: 'Size', value: brushPct, min: 1, max: 25, step: 1, format: (v) => `${v}%`, onInput: (v) => { brushPct = v; } }),
      slider({ label: 'Strength', value: brushS, min: 0.05, max: 1, step: 0.05, format: (v) => v.toFixed(2), onInput: (v) => { brushS = v; } }));
    tools.append(viewSel, brushTools);
    function setView(v) {
      view = v;
      viewSel.querySelector('select').value = v;
      if (v !== 'result' && ts.active) ts.reset();
      refreshTools();
      stage.invalidate();
    }
    const refreshTools = () => { brushTools.hidden = !canBrush(); };

    // ---------- inspector ----------
    const usage = h('div', { style: { marginTop: '8px' } });
    const refreshUsage = () => {
      const p = planFor(s());
      const ws = [];
      if (s().depth.mode !== 'none') {
        ws.push({ level: 'info', text: `Largest shift per frame: ${(p.depth?.pxPerFrame || 0).toFixed(1)} px of a ${p.maxShiftPxPerFrame.toFixed(1)} px budget · ${p.framesBetweenEyes.toFixed(2)} frames between the eyes.` });
        ws.push(...p.warnings.filter((w) => w.code === 'blur-risk' || w.code === 'weak-3d'));
        if (s().orientation === 'horizontal') ws.push({ level: 'warn', text: '3D needs vertical ridges (each eye sees a different strip). Change the ridge direction in Step 2.' });
        if (s().depth.mode === 'layers' && frameSource(s(), store.assets) === 'clip') ws.push({ level: 'error', text: 'Layer depth cannot be used with a video clip. Use a depth map.' });
        if (s().depth.mode === 'ai' && perFrame()) {
          const have = store.assets.clipDepthMaps.filter(Boolean).length;
          if (have < clipCount()) ws.push({ level: 'warn', text: `${have} of ${clipCount()} clip frames have a depth map.${store.assets.depthMap ? ' The others use the single map.' : ' Estimate all frames below.'}` });
        } else if (s().depth.mode === 'ai' && !store.assets.depthMap) ws.push({ level: 'warn', text: 'No depth map yet: estimate, start from layers, or import one below.' });
      }
      usage.replaceChildren(warnings(ws) || '');
    };

    const strength = slider({
      label: 'Strength', value: s().depth.strength, min: 0, max: 2, step: 0.01, format: (v) => v.toFixed(2),
      onInput: (v) => { s().depth.strength = v; stage.invalidate(); },
      onChange: (v) => store.update((st) => { st.depth.strength = v; }),
    });
    const keyPlane = slider({
      label: 'Key plane (stays still)', value: s().depth.keyPlane, min: -1, max: 1, step: 0.05, format: (v) => v.toFixed(2),
      onInput: (v) => { s().depth.keyPlane = v; stage.invalidate(); },
      onChange: (v) => store.update((st) => { st.depth.keyPlane = v; }),
    });
    const fitBudget = button('Fit strength to budget', () => {
      const st = s();
      const maxAbs = st.depth.mode === 'layers'
        ? Math.max(0, ...st.layers.filter((l) => l.visible).map((l) => Math.abs(l.depth - st.depth.keyPlane)))
        : Math.max(Math.abs(1 - st.depth.keyPlane), Math.abs(-1 - st.depth.keyPlane));
      if (!maxAbs) return;
      const v = Math.min(2, +(1 / maxAbs).toFixed(2));
      store.update((x) => { x.depth.strength = v; });
      strength.set(v);
    }, { kind: 'small' });

    const layersBox = h('div');
    const renderLayers = () => {
      clear(layersBox);
      if (!s().layers.length) { layersBox.append(hint('No layers. Add them in Step 3.')); return; }
      [...s().layers].reverse().forEach((l) => {
        layersBox.append(slider({
          label: l.name, value: l.depth, min: -1, max: 1, step: 0.05,
          format: (v) => (v < 0 ? `${v.toFixed(2)} far` : v > 0 ? `+${v.toFixed(2)} near` : '0'),
          onInput: (v) => { l.depth = v; stage.invalidate(); },
          onChange: (v) => store.update((st) => { st.layers.find((x) => x.id === l.id).depth = v; }),
        }));
      });
    };

    /** Replace the clip maps as one undoable step. */
    const setClipMaps = (next) => {
      const prev = store.assets.clipDepthMaps;
      store.recordAction({ undo: () => store.setAssets({ clipDepthMaps: prev }), redo: () => store.setAssets({ clipDepthMaps: next }) });
      store.setAssets({ clipDepthMaps: next });
    };
    /** Set the map being edited: the current clip frame's in per-frame mode, else the single map. */
    const setMap = (m) => {
      if (perFrame()) {
        const next = Array.from({ length: clipCount() }, (_, i) => store.assets.clipDepthMaps[i] || null);
        next[editIdx] = m;
        setClipMaps(next);
      } else {
        const prev = store.assets.depthMap;
        store.recordAction({ undo: () => store.setAssets({ depthMap: prev }), redo: () => store.setAssets({ depthMap: m }) });
        store.setAssets({ depthMap: m });
      }
      setView('overlay');
    };
    const estimateAll = async () => {
      const count = clipCount();
      const maps = [];
      for (let i = 0; i < count; i++) {
        maps.push(await estimateDepth(sourceImage(i), (p, l) => prog.set((i + Math.min(p, 0.99)) / count, `Frame ${i + 1} of ${count}: ${l}`)));
      }
      prog.done();
      setClipMaps(smoothTime ? temporalSmooth(maps, 0.5) : maps);
      setView('overlay');
      toast(`Depth maps ready for all ${count} clip frames.`);
    };
    let dil = 2, blr = 2;
    const layersSec = section('Layer depths', layersBox,
      h('div', { class: 'btn-row' }, button('Spread evenly (back → front)', () => {
        store.update((st) => { const n = st.layers.length; st.layers.forEach((l, i) => { l.depth = n === 1 ? 0 : +(-1 + (2 * i) / (n - 1)).toFixed(2); }); });
        renderLayers();
      }, { kind: 'small' })),
      tip('Drag the dots on the canvas, or use the sliders.', 'Back layers far (−), front layers near (+). The orange marker is the key plane.', 'Each frame shifts a layer by (depth − key plane) × strength × budget pixels, so layers at the key plane stay still.'));
    // ---------- depth per clip frame ----------
    const clipBox = h('div', { class: 'clip-depth' });
    const renderClipBox = () => {
      clear(clipBox);
      if (frameSource(s(), store.assets) !== 'clip') return;
      clipBox.append(checkbox({
        label: 'Depth per clip frame', checked: !!s().depth.perClipFrame,
        hint: 'Each video frame gets its own depth map, so the depth follows the moving subject.',
        onChange: (v) => { store.update((st) => { st.depth.perClipFrame = v; }); editIdx = Math.min(editIdx, clipCount() - 1); renderClipBox(); stage.invalidate(); },
      }));
      if (!perFrame()) return;
      const have = store.assets.clipDepthMaps.filter(Boolean).length;
      const frameSl = slider({
        label: 'Clip frame shown', value: editIdx + 1, min: 1, max: Math.max(1, clipCount()), step: 1,
        format: (v) => `${v} of ${clipCount()}${store.assets.clipDepthMaps[v - 1] ? '' : ' (no map)'}`,
        onInput: (v) => { editIdx = v - 1; if (view === 'result') setView('overlay'); refreshTools(); stage.invalidate(); },
      });
      clipBox.append(
        h('div', { class: 'btn-row' }, button('Estimate all frames with AI', estimateAll, { kind: 'small primary' })),
        checkbox({ label: 'Smooth between frames', checked: smoothTime, hint: 'Blends each map with its neighbours to reduce depth flicker.', onChange: (v) => { smoothTime = v; } }),
        frameSl,
        checkbox({ label: 'Brush all frames', checked: brushAll, hint: 'Paint the same stroke into every frame (for parts that do not move).', onChange: (v) => { brushAll = v; } }),
        hint(`${have} of ${clipCount()} frames have a depth map. The buttons below work on the frame shown; edge cleanup works on all of them.`));
    };
    renderClipBox();

    const mapSec = section('Depth map',
      clipBox,
      h('div', { class: 'btn-row' },
        button('Estimate with AI', async () => {
          if (!frameSource(s(), store.assets)) throw new Error('Add an image in Step 3 (or a clip in Step 4) first.');
          // In per-frame mode this estimates the clip frame being edited.
          const m = await estimateDepth(baseImage(), (p, l) => prog.set(p, l));
          prog.done();
          setMap(m);
          toast('Depth map ready. Paint on the canvas to refine it.');
        }, { kind: 'small primary' }),
        button('From layers', () => setMap(depthFromLayers(s(), store.assets, ...mapSize())), { kind: 'small' }),
        button('Flat grey', () => setMap(createDepthMap(...mapSize(), 128)), { kind: 'small' })),
      prog,
      h('div', { class: 'btn-row', style: { marginTop: '8px' } },
        button('Import depth.png…', async () => { const [f] = await pickFiles({ accept: 'image/*' }); if (f) setMap(await depthMapFromBlob(f, 2048)); }, { kind: 'small ghost' }),
        button('Export depth.png', async () => {
          if (!curMap()) throw new Error('No depth map yet.');
          downloadBlob(await canvasToBlob(depthMapToCanvas(curMap())), perFrame() ? `depth_${String(editIdx + 1).padStart(2, '0')}.png` : 'depth.png');
        }, { kind: 'small ghost' })),
      tip('Paint on the canvas to correct the map.', 'Choose View → Image + depth, then use the brush in the toolbar: Nearer, Farther or Smooth. Ctrl+Z undoes a stroke.'),
      h('h4', {}, 'Edge cleanup'),
      row(
        slider({ label: 'Grow', value: dil, min: 0, max: 12, step: 1, format: (v) => `${v}px`, onInput: (v) => { dil = v; } }),
        slider({ label: 'Smooth', value: blr, min: 0, max: 12, step: 1, format: (v) => `${v}px`, onInput: (v) => { blr = v; } })),
      h('div', { class: 'btn-row' }, button('Apply cleanup', () => {
        // In per-frame mode the cleanup applies to every clip frame's map.
        const maps = perFrame() ? store.assets.clipDepthMaps.filter(Boolean) : [store.assets.depthMap].filter(Boolean);
        if (!maps.length) throw new Error('No depth map yet.');
        const before = maps.map((m) => m.data.slice());
        maps.forEach((m) => edgeCleanup(m, { dilateRadius: dil, blurRadius: blr }));
        const after = maps.map((m) => m.data.slice());
        store.recordAction({ undo: () => { maps.forEach((m, i) => m.data.set(before[i])); store.touchAssets(); }, redo: () => { maps.forEach((m, i) => m.data.set(after[i])); store.touchAssets(); } });
        store.touchAssets();
      }, { kind: 'small' })),
      more('Grows near regions slightly, then smooths, so foreground edges carry their own halo instead of tearing.'));
    const settingsSec = section('Depth settings', keyPlane, strength, h('div', { class: 'btn-row' }, fitBudget), usage);

    const showSections = () => {
      const m = s().depth.mode;
      layersSec.hidden = m !== 'layers';
      mapSec.hidden = m !== 'ai';
      settingsSec.hidden = m === 'none';
    };

    inspector.append(
      section('Mode', radios({
        name: 'depth-mode', value: s().depth.mode,
        options: [['none', 'None'], ['layers', 'Layers'], ['ai', 'Depth map']],
        onChange: (v) => { store.update((st) => { st.depth.mode = v; }); showSections(); setView(v === 'ai' && store.assets.depthMap ? 'overlay' : 'result'); },
      }), hint('Layers: each layer gets a depth. Depth map: for a flat painting, or one map per frame of a video clip.')),
      settingsSec, layersSec, mapSec,
    );
    showSections(); renderLayers(); refreshUsage(); refreshTools();
    ts.refresh();

    let timer = 0;
    const refresh = () => {
      L = paperLayout(s());
      if (!clipBox.contains(document.activeElement)) renderClipBox();
      refreshUsage(); refreshTools();
      stage.invalidate();
      clearTimeout(timer);
      timer = setTimeout(() => ts.refresh(), 250);
    };
    const offs = [store.on('change', refresh), store.on('assets', refresh)];
    return () => { offs.forEach((f) => f()); ts.destroy(); clearTimeout(timer); };
  },
};
