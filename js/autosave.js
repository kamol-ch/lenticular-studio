// Autosave to IndexedDB so a refresh or crash doesn't lose images. Settings
// are already in localStorage; this keeps the binary assets. Print frames and
// the interlaced output are not saved: they are rebuilt.

import { canvasToBlob, blobToCanvas } from './canvas.js';

const DB = 'lenticular-studio', STORE = 'autosave', KEY = 'project';

function open() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req?.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally { db.close(); }
}

let encoded = { rev: -1, mask: null, anim: [] };

export async function saveAutosave(store) {
  const a = store.assets;
  // Re-encode canvases only when frame inputs changed.
  if (encoded.rev !== store.assetsRev) {
    encoded = {
      rev: store.assetsRev,
      mask: a.motionMask ? await canvasToBlob(a.motionMask) : null,
      anim: await Promise.all(a.animFrames.map((c) => canvasToBlob(c))),
    };
  }
  const record = {
    savedAt: Date.now(),
    layerFiles: a.layerFiles,
    depthMap: a.depthMap ? { w: a.depthMap.w, h: a.depthMap.h, data: a.depthMap.data } : null,
    motionMask: encoded.mask,
    animFrames: encoded.anim,
  };
  await tx('readwrite', (s) => s.put(record, KEY));
  store.autosaved = true;
  return record.savedAt;
}

/** Restore assets for the layers in the current state. Returns true if anything was restored. */
export async function loadAutosave(store) {
  const rec = await tx('readonly', (s) => s.get(KEY));
  if (!rec) return false;
  const layerFiles = {}, layerImages = {};
  for (const l of store.state.layers) {
    const blob = rec.layerFiles?.[l.id];
    if (!blob) continue;
    try { layerImages[l.id] = await createImageBitmap(blob); layerFiles[l.id] = blob; } catch { /* unreadable: skip */ }
  }
  const patch = { layerFiles, layerImages };
  if (rec.depthMap) patch.depthMap = { w: rec.depthMap.w, h: rec.depthMap.h, data: new Uint8Array(rec.depthMap.data) };
  if (rec.motionMask) patch.motionMask = await blobToCanvas(rec.motionMask);
  if (rec.animFrames?.length) patch.animFrames = await Promise.all(rec.animFrames.map((b) => blobToCanvas(b)));
  const any = Object.keys(layerFiles).length || patch.depthMap || patch.motionMask || patch.animFrames;
  if (!any) return false;
  store.setAssets(patch);
  store.autosaved = true;
  return true;
}

export function clearAutosave() {
  encoded = { rev: -1, mask: null, anim: [] };
  return tx('readwrite', (s) => s.delete(KEY)).catch(() => {});
}

/** Save a moment after each change. onStatus(text) reports progress. */
export function startAutosave(store, onStatus = () => {}) {
  let timer = 0, running = false, again = false;
  const run = async () => {
    if (running) { again = true; return; }
    running = true;
    try {
      const t = await saveAutosave(store);
      onStatus(`Autosaved in this browser · ${new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
    } catch (e) {
      console.warn('Autosave failed', e);
      onStatus('Autosave unavailable: use Save project');
    } finally {
      running = false;
      if (again) { again = false; schedule(); }
    }
  };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(run, 1500); };
  store.on('change', schedule);
  store.on('assets', () => { if (!store.autosaved) schedule(); });
}
