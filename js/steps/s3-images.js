import { h, card, row, hint, tip, guide, numberField, textField, slider, checkbox, button, dropZone, downloadBlob, pickFiles, toast, clear } from '../ui.js';
import { bleedBoxPx } from '../core/geometry.js';
import { sizeForDisplay, ctx2d } from '../canvas.js';
import { renderComposite } from '../compose.js';
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
  intro: 'Add your painting: one scan, or separate layers for 3D.',
  details: [
    'Layers stack bottom to top: the last one in the list is the back of the card. Use PNG with transparency for cut-outs such as a flower in front of a sky.',
    'For 3D, give each layer a depth here or in Step 5. Paint layers a little wider than needed: 3D shifts reveal their edges.',
  ],
  render(root, { store }) {
    const s = () => store.state;
    let selected = s().layers.at(-1)?.id || null;

    const canvas = h('canvas', { 'aria-label': 'Card preview. Drag to move the selected layer; scroll to resize it.' });
    const stage = h('div', { class: 'stage move' }, canvas);
    const list = h('ul', { class: 'layer-list' });
    const props = h('div');
    const thumbUrls = new Map();

    const thumb = (id) => {
      if (!thumbUrls.has(id) && store.assets.layerFiles[id]) thumbUrls.set(id, URL.createObjectURL(store.assets.layerFiles[id]));
      return thumbUrls.get(id);
    };

    let raf = 0;
    const draw = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const st = s();
        const b = bleedBoxPx(st.card, st.printer.ppi);
        const avail = Math.min(680, stage.clientWidth - 24 || 600);
        sizeForDisplay(canvas, b.w / b.h, avail, 620);
        renderComposite(canvas, { state: st, assets: store.assets });
        const x = ctx2d(canvas);
        const k = canvas.width / b.w;
        // Bleed shading + trim line
        x.save();
        x.fillStyle = 'rgba(0,0,0,0.18)';
        const bp = b.bleedPx * k;
        x.fillRect(0, 0, canvas.width, bp); x.fillRect(0, canvas.height - bp, canvas.width, bp);
        x.fillRect(0, bp, bp, canvas.height - 2 * bp); x.fillRect(canvas.width - bp, bp, bp, canvas.height - 2 * bp);
        x.setLineDash([6, 4]);
        x.strokeStyle = '#e63946';
        x.lineWidth = 1.5;
        x.strokeRect(bp, bp, canvas.width - 2 * bp, canvas.height - 2 * bp);
        const L = st.layers.find((l) => l.id === selected);
        const img = L && store.assets.layerImages[L.id];
        if (img) {
          const dw = L.scale * b.w * k, dh = dw * img.height / img.width;
          x.setLineDash([]);
          x.strokeStyle = '#2a9df4';
          x.lineWidth = 2;
          x.strokeRect(L.x * canvas.width - dw / 2, L.y * canvas.height - dh / 2, dw, dh);
        }
        x.restore();
      });
    };

    const updateLayer = (id, patch, { redrawProps = false } = {}) => {
      store.update((st) => { Object.assign(st.layers.find((l) => l.id === id), patch); }, { silent: false });
      draw();
      if (redrawProps) renderProps();
      renderList();
    };

    const renderList = () => {
      clear(list);
      if (!s().layers.length) { list.append(h('li', { class: 'hint' }, 'No layers yet.')); return; }
      // Top of the stack first.
      [...s().layers].reverse().forEach((l) => {
        list.append(h('li', {
          class: `layer-item ${l.id === selected ? 'selected' : ''}`, tabindex: 0,
          onclick: () => { selected = l.id; renderList(); renderProps(); draw(); },
          onkeydown: (e) => { if (e.key === 'Enter') { selected = l.id; renderList(); renderProps(); draw(); } },
        },
        h('img', { src: thumb(l.id) || '', alt: '' }),
        h('div', { style: { minWidth: 0 } }, h('div', { class: 'layer-name' }, l.name), h('div', { class: 'layer-meta' }, `${l.visible ? '' : 'hidden · '}depth ${l.depth.toFixed(2)} · ${Math.round(l.scale * 100)}%`)),
        h('span', { class: 'tag' }, store.assets.layerImages[l.id] ? `${store.assets.layerImages[l.id].width}×${store.assets.layerImages[l.id].height}` : 'missing')));
      });
    };

    const renderProps = () => {
      clear(props);
      const L = s().layers.find((l) => l.id === selected);
      if (!L) return;
      const img = store.assets.layerImages[L.id];
      const idx = s().layers.indexOf(L);
      props.append(
        h('h4', {}, 'Selected layer'),
        textField({ label: 'Name', value: L.name, onChange: (v) => updateLayer(L.id, { name: v }) }),
        row(
          numberField({ label: 'Centre X', unit: '%', value: +(L.x * 100).toFixed(2), step: 0.5, onChange: (v) => v != null && updateLayer(L.id, { x: v / 100 }) }),
          numberField({ label: 'Centre Y', unit: '%', value: +(L.y * 100).toFixed(2), step: 0.5, onChange: (v) => v != null && updateLayer(L.id, { y: v / 100 }) }),
          numberField({ label: 'Width', unit: '% of card', value: +(L.scale * 100).toFixed(2), step: 1, min: 1, onChange: (v) => v > 0 && updateLayer(L.id, { scale: v / 100 }) }),
        ),
        slider({ label: 'Opacity', value: L.opacity, min: 0, max: 1, step: 0.01, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => { L.opacity = v; draw(); }, onChange: (v) => updateLayer(L.id, { opacity: v }) }),
        slider({ label: 'Depth (for 3D)', value: L.depth, min: -1, max: 1, step: 0.05, format: (v) => (v < 0 ? `${v.toFixed(2)} far` : v > 0 ? `+${v.toFixed(2)} near` : '0 key plane'), onChange: (v) => updateLayer(L.id, { depth: v }) }),
        checkbox({ label: 'Visible', checked: L.visible, onChange: (v) => updateLayer(L.id, { visible: v }) }),
        h('div', { class: 'btn-row' },
          button('Fill card', () => updateLayer(L.id, { x: 0.5, y: 0.5, scale: fitScale(img, s().card, s().printer.ppi, 'cover') }, { redrawProps: true }), { kind: 'small' }),
          button('Fit inside', () => updateLayer(L.id, { x: 0.5, y: 0.5, scale: fitScale(img, s().card, s().printer.ppi, 'contain') }, { redrawProps: true }), { kind: 'small' }),
          button('Move up', () => move(idx, +1), { kind: 'small', disabled: idx === s().layers.length - 1 }),
          button('Move down', () => move(idx, -1), { kind: 'small', disabled: idx === 0 }),
          button('Delete', () => {
            if (!confirm(`Delete layer "${L.name}"?`)) return;
            store.update((st) => { st.layers = st.layers.filter((l) => l.id !== L.id); });
            const { [L.id]: _f, ...files } = store.assets.layerFiles;
            const { [L.id]: _i, ...imgs } = store.assets.layerImages;
            store.setAssets({ layerFiles: files, layerImages: imgs });
            selected = s().layers.at(-1)?.id || null;
            renderList(); renderProps(); draw();
          }, { kind: 'small danger' }),
        ),
        tip('Depth: − is far, + is near.', 'Painted wider than the card? Good: 3D shifts reveal the edges, so extra painting around a layer avoids gaps.'),
      );
    };

    const move = (idx, dir) => {
      store.update((st) => {
        const j = idx + dir;
        if (j < 0 || j >= st.layers.length) return;
        [st.layers[idx], st.layers[j]] = [st.layers[j], st.layers[idx]];
      });
      renderList(); renderProps(); draw();
    };

    // ----- pointer interaction -----
    let drag = null;
    canvas.addEventListener('pointerdown', (e) => {
      const L = s().layers.find((l) => l.id === selected);
      if (!L) return;
      canvas.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, lx: L.x, ly: L.y };
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const L = s().layers.find((l) => l.id === selected);
      const r = canvas.getBoundingClientRect();
      L.x = drag.lx + (e.clientX - drag.x) / r.width;
      L.y = drag.ly + (e.clientY - drag.y) / r.height;
      draw();
    });
    const endDrag = () => {
      if (!drag) return;
      drag = null;
      store.update(() => {});
      renderProps(); renderList();
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    let wheelTimer = 0;
    canvas.addEventListener('wheel', (e) => {
      const L = s().layers.find((l) => l.id === selected);
      if (!L) return;
      e.preventDefault();
      L.scale = Math.max(0.02, L.scale * Math.pow(1.0015, -e.deltaY));
      draw();
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => { store.update(() => {}); renderProps(); renderList(); }, 250);
    }, { passive: false });

    const onFiles = async (files) => {
      const added = await addLayerFiles(store, files);
      if (added.length) { selected = added.at(-1).id; renderList(); renderProps(); draw(); toast(`Added ${added.length} layer(s).`); }
    };

    root.append(
      h('div', { class: 'cols-wide' },
        card(null, stage, hint('Drag to move · scroll to resize · red dashes = cut line')),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '18px' } },
          card('Layers',
            guide([['layers', 'Upload', 'A scan, or PNG cut-outs'], ['arrange', 'Arrange', 'Drag to move, scroll to size']]),
            dropZone({ accept: 'image/*', multiple: true, onFiles, label: 'Drop scans or PNG layers here, or click to choose' }),
            h('div', { style: { marginTop: '12px' } }, list),
            props),
          card('Import / export',
            h('div', { class: 'btn-row' },
              button('Export source.zip', async () => downloadBlob(await exportSource(), 'source.zip'), { disabled: !s().layers.length }),
              button('Import source.zip…', async () => {
                const [f] = await pickFiles({ accept: '.zip' });
                if (!f) return;
                await importSource(f);
                selected = s().layers.at(-1)?.id || null;
                renderList(); renderProps(); draw();
                toast('Layers imported.');
              }, { kind: 'ghost' }),
            )),
        ),
      ),
    );
    renderList(); renderProps(); draw();
    const ro = new ResizeObserver(draw);
    ro.observe(stage);
    return () => { ro.disconnect(); cancelAnimationFrame(raf); thumbUrls.forEach((u) => URL.revokeObjectURL(u)); };
  },
};
