// Promise wrapper around the pixel worker.

let worker = null;
let nextId = 1;
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./workers/pixel-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const { id, result, error, progress } = e.data;
    const p = pending.get(id);
    if (!p) return;
    if (progress != null) { p.onProgress?.(progress); return; }
    pending.delete(id);
    if (error) p.reject(new Error(error)); else p.resolve(result);
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || 'Worker failed to load.'));
    pending.clear();
    worker = null;
  };
  return worker;
}

export function callWorker(op, payload = {}, { transfer = [], onProgress } = {}) {
  const w = getWorker();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    w.postMessage({ id, op, payload }, transfer);
  });
}

let loadedFramesKey = null;

/** Send frames to the worker (skipped if the same canvases are already loaded). */
export async function loadFramesIntoWorker(canvases, key = null) {
  if (key && key === loadedFramesKey) return;
  const frames = canvases.map((c) => {
    const img = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);
    return { width: img.width, height: img.height, buffer: img.data.buffer };
  });
  await callWorker('setFrames', { frames }, { transfer: frames.map((f) => f.buffer) });
  loadedFramesKey = key;
}

export function forgetWorkerFrames() { loadedFramesKey = null; }
