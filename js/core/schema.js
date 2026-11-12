// Project state schema, defaults and (de)serialisation. Pure, DOM-free.

export const PROJECT_VERSION = 1;

export const STEP_IDS = [1, 2, 3, 4, 5, 6, 7];

export function defaultState() {
  return {
    version: PROJECT_VERSION,
    name: 'Untitled card',
    effect: '3d', // '3d' | 'animation' | '3d-motion'
    lens: {
      lpiNominal: 75, lpiMeasured: null, angleDeg: null, orientation: 'vertical',
      sheetWidthMm: null, sheetHeightMm: null,
    },
    printer: { ppi: 720, model: 'Epson L3250' },
    card: { widthMm: 100, heightMm: 150, bleedMm: 3 },
    tests: { pitchFrom: 74.6, pitchTo: 75.4, pitchStep: 0.05 },
    plan: { frames: 8, samplesPerLens: 3, budgetLensPerFrame: 1, viewDistMm: 400, ipdMm: 63 },
    layers: [],
    animation: {
      mode: 'none', // 'none' | 'simple' | 'clip'
      effects: [],
      clip: { start: 0, end: 2, pingPong: true, align: false, fileName: null },
      previewFps: 8,
    },
    depth: { mode: 'none', keyPlane: 0, strength: 0.6 }, // mode: 'none' | 'layers' | 'ai'
    interlace: { reverse: true, marks: true, tileOnA4: false, phaseOffset: 0, marginMm: 8 },
    print: { checklist: {} },
    steps: { 1: 'todo', 2: 'todo', 3: 'todo', 4: 'todo', 5: 'todo', 6: 'todo', 7: 'todo' },
  };
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Deep-merge `src` onto `base`; arrays and primitives from src replace. */
export function deepMerge(base, src) {
  if (!isObj(src)) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(src)) {
    out[k] = isObj(v) && isObj(base[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

export function normalizeState(json) {
  const parsed = typeof json === 'string' ? JSON.parse(json) : json;
  if (parsed.version && parsed.version > PROJECT_VERSION) {
    throw new Error(`Project version ${parsed.version} is newer than this app (${PROJECT_VERSION}).`);
  }
  const s = deepMerge(defaultState(), parsed);
  s.version = PROJECT_VERSION;
  s.layers = (s.layers || []).map((l, i) => ({
    id: l.id || `layer${i + 1}`, name: l.name || `Layer ${i + 1}`, file: l.file || null,
    x: num(l.x, 0.5), y: num(l.y, 0.5), scale: num(l.scale, 1), opacity: num(l.opacity, 1),
    visible: l.visible !== false, depth: num(l.depth, 0),
  }));
  return s;
}

function num(v, d) { return typeof v === 'number' && Number.isFinite(v) ? v : d; }

export function serializeState(state) {
  return JSON.stringify(state, null, 2);
}

/** Slices exported/imported by individual steps (plan §4). */
export const SLICES = {
  lens: (s) => ({ kind: 'lens-profile', version: PROJECT_VERSION, effect: s.effect, lens: s.lens, printer: s.printer, card: s.card, tests: s.tests }),
  plan: (s, derived) => ({ kind: 'plan', version: PROJECT_VERSION, plan: s.plan, derived }),
};

export function applySlice(state, slice) {
  if (!slice || !slice.kind) throw new Error('Not a Lenticular Studio file.');
  const pick = {
    'lens-profile': ['effect', 'lens', 'printer', 'card', 'tests'],
    plan: ['plan'],
    layers: ['layers'],
    animation: ['animation'],
    depth: ['depth'],
  }[slice.kind];
  if (!pick) throw new Error(`Unknown file kind "${slice.kind}".`);
  const partial = {};
  for (const k of pick) if (k in slice) partial[k] = slice[k];
  return normalizeState(deepMerge(state, partial));
}
