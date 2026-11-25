// Project bundle and per-step slice import/export (plan §4). Uses JSZip (global).

import { store, emptyAssets } from './store.js';
import { normalizeState, serializeState, PROJECT_VERSION, applySlice } from './core/schema.js';
import { frameGeometry } from './core/geometry.js';
import { canvasToBlob, blobToCanvas, depthMapToCanvas, depthMapFromBlob } from './canvas.js';
import { importFrameImages, setFrames } from './pipeline.js';

function zipLib() {
  if (!window.JSZip) throw new Error('JSZip failed to load (offline?). Project bundles need it; refresh when online.');
  return new window.JSZip();
}

async function openZip(file) {
  zipLib();
  return window.JSZip.loadAsync(file);
}

const pad = (i) => String(i + 1).padStart(2, '0');
const extOf = (blob, fallback = 'png') => ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[blob?.type] || fallback);

function sortedFiles(zip, prefix, re = /\.(png|jpe?g|webp)$/i) {
  return Object.values(zip.files)
    .filter((f) => !f.dir && f.name.startsWith(prefix) && re.test(f.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

async function entryBlob(entry) {
  const ext = entry.name.split('.').pop().toLowerCase();
  const type = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
  return new Blob([await entry.async('arraybuffer')], { type });
}

// ---------- Full project ----------

export async function saveProject(onProgress = () => {}) {
  const zip = zipLib();
  const { state, assets } = store;
  const s = structuredClone(state);

  for (const layer of s.layers) {
    const blob = assets.layerFiles[layer.id];
    if (blob) {
      layer.file = `source/${layer.id}.${extOf(blob)}`;
      zip.file(layer.file, blob);
    }
  }
  if (assets.pitchTest) zip.file('lens/pitch-test.png', assets.pitchTest);
  if (assets.motionMask) zip.file('animation/mask.png', await canvasToBlob(assets.motionMask));
  onProgress(0.2, 'Animation frames');
  for (let i = 0; i < assets.animFrames.length; i++) zip.file(`animation/frame_${pad(i)}.png`, await canvasToBlob(assets.animFrames[i]));
  if (assets.depthMap) zip.file('depth/depth.png', await canvasToBlob(depthMapToCanvas(assets.depthMap)));
  for (let i = 0; i < assets.clipDepthMaps.length; i++) {
    const m = assets.clipDepthMaps[i];
    if (m) zip.file(`depth/clip/depth_${pad(i)}.png`, await canvasToBlob(depthMapToCanvas(m)));
  }
  onProgress(0.5, 'Final frames');
  await addFrames(zip, 'frames/');
  if (assets.output) zip.file('output/interlaced.png', assets.output);
  zip.file('project.json', serializeState(s));
  onProgress(0.8, 'Compressing');
  return zip.generateAsync({ type: 'blob', compression: 'STORE' }, (m) => onProgress(0.8 + 0.2 * (m.percent / 100)));
}

async function addFrames(zip, prefix) {
  const { assets, state } = store;
  if (!assets.frames.length) return;
  const g = frameGeometry(state);
  zip.file(`${prefix}frames.json`, JSON.stringify({
    kind: 'frames', version: PROJECT_VERSION, count: assets.frames.length,
    width: assets.frames[0].width, height: assets.frames[0].height, outW: g.outW, outH: g.outH,
    signature: assets.framesSig, workingResolution: true,
    note: 'Frames are stored at working resolution (squeezed along the interlace axis). Stretch to outW×outH to view.',
  }, null, 2));
  for (let i = 0; i < assets.frames.length; i++) zip.file(`${prefix}frame_${pad(i)}.png`, await canvasToBlob(assets.frames[i]));
}

export async function loadProject(file, onProgress = () => {}) {
  const zip = await openZip(file);
  const pj = zip.file('project.json');
  if (!pj) throw new Error('project.json not found in this zip.');
  const state = normalizeState(await pj.async('string'));
  const assets = emptyAssets();

  onProgress(0.1, 'Images');
  for (const layer of state.layers) {
    const entry = layer.file && zip.file(layer.file);
    if (!entry) continue;
    const blob = await entryBlob(entry);
    assets.layerFiles[layer.id] = blob;
    assets.layerImages[layer.id] = await createImageBitmap(blob);
  }
  const pt = zip.file('lens/pitch-test.png');
  if (pt) assets.pitchTest = await entryBlob(pt);
  const mask = zip.file('animation/mask.png');
  if (mask) assets.motionMask = await blobToCanvas(await entryBlob(mask));
  onProgress(0.3, 'Animation');
  for (const e of sortedFiles(zip, 'animation/frame_')) assets.animFrames.push(await blobToCanvas(await entryBlob(e)));
  const depth = zip.file('depth/depth.png');
  if (depth) assets.depthMap = await depthMapFromBlob(await entryBlob(depth), 4096);
  for (const e of sortedFiles(zip, 'depth/clip/depth_')) {
    const i = Number(/depth_(\d+)/.exec(e.name)?.[1]) - 1; // file numbers start at 1
    if (i < 0) continue;
    if (Number.isInteger(i) && i < assets.animFrames.length) assets.clipDepthMaps[i] = await depthMapFromBlob(await entryBlob(e), 4096);
  }
  onProgress(0.6, 'Frames');
  const frameEntries = sortedFiles(zip, 'frames/frame_');
  const out = zip.file('output/interlaced.png');
  if (out) assets.output = await entryBlob(out);

  store.replaceAll(state, assets);
  if (frameEntries.length) {
    const metaEntry = zip.file('frames/frames.json');
    const meta = metaEntry ? JSON.parse(await metaEntry.async('string')) : null;
    const frames = await importFrameImages(await Promise.all(frameEntries.map(entryBlob)), { workingRes: !!meta?.workingResolution });
    setFrames(frames, 'imported');
    if (out) store.setAssets({ output: assets.output });
  }
  store.dirty = false;
  onProgress(1, 'Done');
}

// ---------- Step slices ----------

export async function exportSource() {
  const zip = zipLib();
  const layers = structuredClone(store.state.layers);
  for (const l of layers) {
    const blob = store.assets.layerFiles[l.id];
    if (blob) { l.file = `source/${l.id}.${extOf(blob)}`; zip.file(l.file, blob); }
  }
  zip.file('layers.json', JSON.stringify({ kind: 'layers', version: PROJECT_VERSION, layers }, null, 2));
  return zip.generateAsync({ type: 'blob' });
}

export async function importSource(file) {
  const zip = await openZip(file);
  const meta = zip.file('layers.json');
  if (!meta) throw new Error('layers.json not found — is this a source.zip?');
  const slice = JSON.parse(await meta.async('string'));
  const next = applySlice(store.state, slice);
  const layerFiles = {}, layerImages = {};
  for (const l of next.layers) {
    const e = l.file && zip.file(l.file);
    if (!e) continue;
    const blob = await entryBlob(e);
    layerFiles[l.id] = blob;
    layerImages[l.id] = await createImageBitmap(blob);
  }
  store.replaceState(next);
  store.setAssets({ layerFiles, layerImages });
}

export async function exportAnimation(renderedFrames) {
  const zip = zipLib();
  zip.file('animation.json', JSON.stringify({ kind: 'animation', version: PROJECT_VERSION, animation: store.state.animation }, null, 2));
  for (let i = 0; i < renderedFrames.length; i++) zip.file(`frame_${pad(i)}.png`, await canvasToBlob(renderedFrames[i]));
  if (store.assets.motionMask) zip.file('mask.png', await canvasToBlob(store.assets.motionMask));
  return zip.generateAsync({ type: 'blob' });
}

/** Import animation.zip, or any zip of frame images, as a clip sequence. */
export async function importAnimation(file) {
  const zip = await openZip(file);
  const meta = zip.file('animation.json');
  const entries = sortedFiles(zip, '').filter((e) => !/mask\.png$/i.test(e.name));
  if (!entries.length) throw new Error('No frame images in this zip.');
  const animFrames = [];
  for (const e of entries) animFrames.push(await blobToCanvas(await entryBlob(e)));
  if (meta) {
    const slice = JSON.parse(await meta.async('string'));
    store.replaceState(applySlice(store.state, slice));
  }
  store.update((s) => { s.animation.mode = 'clip'; s.animation.clip.fileName = file.name; });
  const mask = zip.file('mask.png');
  store.setAssets({ animFrames, clipDepthMaps: [], ...(mask ? { motionMask: await blobToCanvas(await entryBlob(mask)) } : {}) });
}

export async function exportFrames() {
  const zip = zipLib();
  await addFrames(zip, '');
  return zip.generateAsync({ type: 'blob' });
}

/** Import frames.zip (ours) or a zip / list of plain images as final frames. */
export async function importFrames(files) {
  const blobs = [];
  let workingRes = false;
  files = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      const zip = await openZip(f);
      const meta = zip.file('frames.json');
      if (meta) workingRes = !!JSON.parse(await meta.async('string')).workingResolution;
      for (const e of sortedFiles(zip, '')) blobs.push(await entryBlob(e));
    } else if (f.type.startsWith('image/')) {
      blobs.push(f);
    }
  }
  if (blobs.length < 2) throw new Error('Need at least 2 frame images.');
  if (blobs.length > 255) throw new Error('Too many frames.');
  if (blobs.length !== store.state.plan.frames) {
    store.update((s) => { s.plan.frames = blobs.length; });
  }
  const frames = await importFrameImages(blobs, { workingRes });
  setFrames(frames, 'imported');
  return frames.length;
}
