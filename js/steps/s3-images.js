import { h, row, hint, tip, section, numberField, textField, slider, checkbox, button, dropZone, downloadBlob, pickFiles, toast, clear } from '../ui.js';
import { bleedBoxPx } from '../core/geometry.js';
import { paperLayout, drawCardOnPaper, createCardImage, inflate, inRect } from '../scene.js';
import { exportSource, importSource } from '../project-io.js';

const uid = () => Math.random().toString(36).slice(2, 8);

/** Scale (fraction of card width) so the image covers / fits the card. */
export function fitScale(img, card, ppi, mode = 'cover') {
  const { w, h } = bleedBoxPx(card, ppi);
  const A = w / h, a = img.width / img.height;
  return mode === 'cover' ? Math.max(1, a / A) : Math.min(1, a / A);
}

export async function addLayerFiles(store, files) {
  const layerFiles = { ...store.assets.layerFiles };
  const layerImages = { ...store.assets.layerImages };
  const added = [];
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    const id = `l_${uid()}`;
    let bmp;
    try { bmp = await createImageBitmap(f); } catch { toast(`Could not read ${f.name}`, 'error'); continue; }
    layerFiles[id] = f;
    layerImages[id] = bmp;
    added.push({
      id, name: f.name.replace(/\.[^.]+$/, ''),
      file: `source/${id}.${({ 'image/jpeg': 'jpg', 'image/webp': 'webp' })[f.type] || 'png'}`,
      x: 0.5, y: 0.5, scale: fitScale(bmp, store.state.card, store.state.printer.ppi, 'cover'),
      opacity: 1, visible: true, depth: 0,
    });
  }
  if (!added.length) return [];
  store.setAssets({ layerFiles, layerImages });
  store.update((s) => { s.layers.push(...added); s.steps[3] = 'done'; });
  return added;
}

export default {
  id: 3,
  title: 'Images',
  subtitle: 'Paintings & layers',
  intro: 'Add your painting and place it on the card.',
  details: [
    'Drag a layer to move it; drag a corner handle to resize. Scroll to zoom the view, drag the background to pan, double-click to fit.',
    'Layers stack bottom to top: the last one in the list is the back of the card. Use PNG with transparency for cut-outs such as a flower in front of a sky.',
    'Cover the red bleed band: anything inside the red dashes is the finished card. For 3D, paint layers a little wider than needed, because 3D shifts reveal their edges.',
  ],
  editor({ store, stage, inspector, tools }) {
    const s = () => store.state;
    let selected = s().layers.at(-1)?.id || null;
    let L = paperLayout(s());
    const cardImage = createCardImage(store);
    const thumbUrls = new Map();
    const thumb = (id) => {
      if (!thumbUrls.has(id) && store.assets.layerFiles[id]) thumbUrls.set(id, URL.createObjectURL(store.assets.layerFiles[id]));
      return thumbUrls.get(id);
    };

    const layerById = (id) => s().layers.find((l) => l.id === id);
    const boxOf = (l) => {
      const img = store.assets.layerImages[l.id];
      if (!img) return null;
      const w = l.scale * L.card.w, hh = (w * img.height) / img.width;
      const cx = L.card.x + l.x * L.card.w, cy = L.card.y + l.y * L.card.h;
      return { x: cx - w / 2, y: cy - hh / 2, w, h: hh, cx, cy };
    };
    const corners = (b) => [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]];
    const handleAt = (pt) => {
      const l = layerById(selected);
      const b = l && boxOf(l);
      if (!b) return -1;
      const tol = 10 / stage.scale;
      return corners(b).findIndex(([x, y]) => Math.abs(pt.x - x) <= tol && Math.abs(pt.y - y) <= tol);
    };
    const layerAt = (pt) => [...s().layers].reverse().find((l) => { const b = l.visible && boxOf(l); return b && inRect(pt, b); });

    const redraw = () => { cardImage.touch(); stage.invalidate(); };
    const select = (id) => { selected = id; renderList(); renderProps(); stage.invalidate(); };
    const commit = () => { store.update(() => {}); renderList(); renderProps(); };

    stage.setScene({
      bounds: () => inflate(L.card, 12),
      draw(ctx, v) {
        const has = s().layers.some((l) => store.assets.layerImages[l.id]);
        drawCardOnPaper(ctx, v, L, s(), { image: has ? cardImage.get(v, L.card) : null, dimPaper: true, emptyText: 'Drop a scan here, or use “Add images”' });
        const l = layerById(selected);
        const b = l && boxOf(l);
        if (!b) return;
        ctx.save();
        ctx.strokeStyle = v.colors.select;
        ctx.lineWidth = 1.5 * v.px;
        ctx.strokeRect(b.x, b.y, b.w, b.h);
        const hs = 4.5 * v.px;
        for (const [x, y] of corners(b)) {
          ctx.fillStyle = '#fff';
          ctx.fillRect(x - hs, y - hs, hs * 2, hs * 2);
          ctx.strokeRect(x - hs, y - hs, hs * 2, hs * 2);
        }
        ctx.restore();
      },
      hover(pt) {
        const i = handleAt(pt);
        if (i >= 0) return i % 2 === 0 ? 'nwse-resize' : 'nesw-resize';
        const l = layerAt(pt);
        return l ? (l.id === selected ? 'move' : 'pointer') : 'grab';
      },
      pointerDown(pt) {
        if (handleAt(pt) >= 0) {
          const l = layerById(selected), b = boxOf(l);
          const d0 = Math.hypot(pt.x - b.cx, pt.y - b.cy) || 1, s0 = l.scale;
          return {
            move: (p) => { l.scale = Math.max(0.02, (s0 * Math.hypot(p.x - b.cx, p.y - b.cy)) / d0); cardImage.touch(); },
            up: commit,
          };
        }
        const l = layerAt(pt);
        if (!l) { if (selected) select(null); return null; }
        if (l.id !== selected) select(l.id);
        const x0 = l.x, y0 = l.y;
        return {
          move: (p) => { l.x = x0 + (p.x - pt.x) / L.card.w; l.y = y0 + (p.y - pt.y) / L.card.h; cardImage.touch(); },
          up: commit,
        };
      },
      key(e) {
        const l = layerById(selected);
        if (!l) return false;
        const step = (e.shiftKey ? 2 : 0.5);
        const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
        if (d) { l.x += (d[0] * step) / L.card.w; l.y += (d[1] * step) / L.card.h; cardImage.touch(); commit(); return true; }
        if (e.key === 'Delete' || e.key === 'Backspace') { removeLayer(l); return true; }
        return false;
      },
    });

    // ---------- inspector ----------
    const list = h('ul', { class: 'layer-list' });
    const props = h('div');

    const updateLayer = (id, patch) => { store.update((st) => { Object.assign(st.layers.find((l) => l.id === id), patch); }); renderList(); renderProps(); };
    const move = (idx, dir) => {
      store.update((st) => {
        const j = idx + dir;
        if (j < 0 || j >= st.layers.length) return;
        [st.layers[idx], st.layers[j]] = [st.layers[j], st.layers[idx]];
      });
      renderList(); renderProps();
    };
    const removeLayer = (l) => {
      if (!confirm(`Delete layer "${l.name}"?`)) return;
      store.update((st) => { st.layers = st.layers.filter((x) => x.id !== l.id); });
      const { [l.id]: _f, ...files } = store.assets.layerFiles;
      const { [l.id]: _i, ...imgs } = store.assets.layerImages;
      store.setAssets({ layerFiles: files, layerImages: imgs });
      select(s().layers.at(-1)?.id || null);
    };

    function renderList() {
      clear(list);
      if (!s().layers.length) { list.append(h('li', { class: 'hint' }, 'No layers yet.')); return; }
      [...s().layers].reverse().forEach((l) => {
        const img = store.assets.layerImages[l.id];
        list.append(h('li', {
          class: `layer-item ${l.id === selected ? 'selected' : ''}`, tabindex: 0,
          onclick: () => select(l.id),
          onkeydown: (e) => { if (e.key === 'Enter') select(l.id); },
        },
        h('img', { src: thumb(l.id) || '', alt: '' }),
        h('div', { style: { minWidth: 0 } }, h('div', { class: 'layer-name' }, l.name), h('div', { class: 'layer-meta' }, `${l.visible ? '' : 'hidden · '}depth ${l.depth.toFixed(2)} · ${Math.round(l.scale * 100)}%`)),
        h('span', { class: 'tag' }, img ? `${img.width}×${img.height}` : 'missing')));
      });
    }

    function renderProps() {
      clear(props);
      const l = layerById(selected);
      if (!l) { props.append(hint('Click a layer on the card or in the list.')); return; }
      const img = store.assets.layerImages[l.id];
      const idx = s().layers.indexOf(l);
      props.append(
        textField({ label: 'Name', value: l.name, onChange: (v) => updateLayer(l.id, { name: v }) }),
        row(
          numberField({ label: 'Centre X', unit: '%', value: +(l.x * 100).toFixed(1), step: 0.5, onChange: (v) => v != null && updateLayer(l.id, { x: v / 100 }) }),
          numberField({ label: 'Centre Y', unit: '%', value: +(l.y * 100).toFixed(1), step: 0.5, onChange: (v) => v != null && updateLayer(l.id, { y: v / 100 }) }),
        ),
        numberField({ label: 'Width', unit: '% of card', value: +(l.scale * 100).toFixed(1), step: 1, min: 1, onChange: (v) => v > 0 && updateLayer(l.id, { scale: v / 100 }) }),
        slider({ label: 'Opacity', value: l.opacity, min: 0, max: 1, step: 0.01, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => { l.opacity = v; redraw(); }, onChange: (v) => updateLayer(l.id, { opacity: v }) }),
        slider({ label: 'Depth (for 3D)', value: l.depth, min: -1, max: 1, step: 0.05, format: (v) => (v < 0 ? `${v.toFixed(2)} far` : v > 0 ? `+${v.toFixed(2)} near` : '0 key plane'), onChange: (v) => updateLayer(l.id, { depth: v }) }),
        checkbox({ label: 'Visible', checked: l.visible, onChange: (v) => updateLayer(l.id, { visible: v }) }),
        h('div', { class: 'btn-row' },
          button('Fill card', () => updateLayer(l.id, { x: 0.5, y: 0.5, scale: fitScale(img, s().card, s().printer.ppi, 'cover') }), { kind: 'small' }),
          button('Fit inside', () => updateLayer(l.id, { x: 0.5, y: 0.5, scale: fitScale(img, s().card, s().printer.ppi, 'contain') }), { kind: 'small' }),
          button('Forward', () => move(idx, +1), { kind: 'small', disabled: idx === s().layers.length - 1 }),
          button('Back', () => move(idx, -1), { kind: 'small', disabled: idx === 0 }),
          button('Delete', () => removeLayer(l), { kind: 'small danger' })),
      );
    }

    const onFiles = async (files) => {
      const added = await addLayerFiles(store, files);
      if (added.length) { select(added.at(-1).id); toast(`Added ${added.length} layer(s).`); }
    };

    tools.append(button('+ Add images', async () => { const f = await pickFiles({ accept: 'image/*', multiple: true }); if (f.length) await onFiles(f); }, { kind: 'small primary' }));

    // Drop files straight onto the canvas.
    const over = (e) => { e.preventDefault(); };
    const drop = (e) => { e.preventDefault(); const f = [...e.dataTransfer.files]; if (f.length) onFiles(f); };
    stage.canvas.addEventListener('dragover', over);
    stage.canvas.addEventListener('drop', drop);

    inspector.append(
      section('Layers',
        dropZone({ accept: 'image/*', multiple: true, onFiles, label: 'Drop scans or PNG layers, or click to choose' }),
        h('div', { style: { marginTop: '10px' } }, list),
        hint('Top of the list is the front of the card.')),
      section('Selected layer', props,
        tip('Depth: − is far, + is near.', 'Painted wider than the card? Good: 3D shifts reveal the edges, so extra painting around a layer avoids gaps. Arrow keys nudge the selected layer (Shift for bigger steps).')),
      section('Import / export',
        h('div', { class: 'btn-row' },
          button('Export source.zip', async () => downloadBlob(await exportSource(), 'source.zip'), { kind: 'small' }),
          button('Import source.zip…', async () => {
            const [f] = await pickFiles({ accept: '.zip' });
            if (!f) return;
            await importSource(f);
            select(s().layers.at(-1)?.id || null);
            toast('Layers imported.');
          }, { kind: 'small ghost' })),
        { closed: true }),
    );
    renderList(); renderProps();

    const refresh = () => { L = paperLayout(s()); redraw(); };
    const offs = [store.on('change', refresh), store.on('assets', refresh)];
    return () => {
      offs.forEach((f) => f());
      stage.canvas.removeEventListener('dragover', over);
      stage.canvas.removeEventListener('drop', drop);
      thumbUrls.forEach((u) => URL.revokeObjectURL(u));
    };
  },
};
