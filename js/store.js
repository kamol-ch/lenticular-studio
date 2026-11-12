// App store: JSON-serialisable `state` plus in-memory binary `assets`.

import { defaultState, normalizeState, serializeState } from './core/schema.js';
import { framesSignature } from './core/geometry.js';

const LS_KEY = 'lenticular-studio:state';

export function emptyAssets() {
  return {
    pitchTest: null,      // Blob
    layerFiles: {},       // id → Blob (original upload)
    layerImages: {},      // id → ImageBitmap
    motionMask: null,     // HTMLCanvasElement (card aspect, white = masked)
    animFrames: [],       // HTMLCanvasElement[] (card aspect)
    clipFile: null,       // File (not saved in project)
    depthMap: null,       // { w, h, data: Uint8Array }
    frames: [],           // HTMLCanvasElement[] at working resolution
    framesSig: null,
    framesSource: null,   // 'built' | 'imported'
    output: null,         // Blob
    outputInfo: null,
  };
}

class Store extends EventTarget {
  constructor() {
    super();
    this.state = defaultState();
    this.assets = emptyAssets();
    this.dirty = false;
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) this.state = normalizeState(saved);
    } catch (e) {
      console.warn('Could not restore saved settings', e);
    }
  }

  /** Mutate state through a function, then persist and notify. */
  update(fn, { silent = false } = {}) {
    fn(this.state);
    this.persist();
    if (!silent) this.emit('change');
  }

  replaceState(next) {
    this.state = normalizeState(next);
    this.persist();
    this.emit('change');
  }

  replaceAll(state, assets) {
    this.state = normalizeState(state);
    this.assets = { ...emptyAssets(), ...assets };
    this.dirty = false;
    this.persist();
    this.emit('change');
    this.emit('assets');
  }

  setAssets(patch) {
    Object.assign(this.assets, patch);
    this.dirty = true;
    this.emit('assets');
  }

  setStep(id, status) {
    if (this.state.steps[id] === status) return;
    this.update((s) => { s.steps[id] = status; });
  }

  persist() {
    try { localStorage.setItem(LS_KEY, serializeState(this.state)); } catch { /* quota or private mode */ }
  }

  emit(type) { this.dispatchEvent(new Event(type)); }

  on(type, fn) {
    this.addEventListener(type, fn);
    return () => this.removeEventListener(type, fn);
  }

  framesStatus() {
    const n = this.assets.frames.length;
    if (!n) return { ok: false, text: 'No frames yet' };
    const stale = this.assets.framesSig !== framesSignature(this.state);
    return { ok: !stale, stale, text: stale ? `${n} frames (out of date for current settings)` : `${n} frames ready` };
  }
}

export const store = new Store();
