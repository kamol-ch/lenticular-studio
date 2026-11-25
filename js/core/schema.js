// Project state schema, defaults and (de)serialisation. Pure, DOM-free.

export const PROJECT_VERSION = 1;

export const STEP_IDS = [1, 2, 3, 4, 5, 6, 7];

export function defaultState() {
  return {
    version: PROJECT_VERSION,
    name: 'Untitled card',
    // Card design (Step 2)
    effect: '3d', // '3d' | 'animation' | '3d-motion'
    orientation: 'vertical', // ridge direction: 'vertical' | 'horizontal'
    // Calibration (Step 1)
    printer: { ppi: 720, inkSpreadMm: 0 }, // ink spread: how far ink creeps on this paper, per edge
    media: { name: 'A4', widthMm: 210, heightMm: 297, marginMm: 3 },
    lens: {
      lpiNominal: 75, lpiMeasured: null, angleDeg: null,
      sheetWidthMm: null, sheetHeightMm: null,
    },
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
    depth: { mode: 'none', keyPlane: 0, strength: 0.6, perClipFrame: false }, // mode: 'none' | 'layers' | 'ai'; perClipFrame: one depth map per video-clip frame
    interlace: { reverse: true, marks: true, tileOnMedia: false, phaseOffset: 0, marginMm: 8, smoothEdges: true },
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
  const s = deepMerge(defaultState(), migrate(parsed));
  s.version = PROJECT_VERSION;
  s.layers = (s.layers || []).map((l, i) => ({
    id: l.id || `layer${i + 1}`, name: l.name || `Layer ${i + 1}`, file: l.file || null,
    x: num(l.x, 0.5), y: num(l.y, 0.5), scale: num(l.scale, 1), opacity: num(l.opacity, 1),
    visible: l.visible !== false, depth: num(l.depth, 0),
  }));
  return s;
}

/** Older projects kept ridge orientation on the lens and tiled only on A4. */
function migrate(raw) {
  const p = JSON.parse(JSON.stringify(raw || {}));
  if (p.lens && 'orientation' in p.lens) {
    if (p.orientation === undefined) p.orientation = p.lens.orientation;
    delete p.lens.orientation;
  }
  if (p.interlace && 'tileOnA4' in p.interlace) {
    if (p.interlace.tileOnMedia === undefined) p.interlace.tileOnMedia = p.interlace.tileOnA4;
    delete p.interlace.tileOnA4;
  }
  if (p.printer) delete p.printer.model;
  return p;
}

function num(v, d) { return typeof v === 'number' && Number.isFinite(v) ? v : d; }

export function serializeState(state) {
  return JSON.stringify(state, null, 2);
}

/** Slices exported/imported by individual steps (plan §4). */
export const SLICES = {
  lens: (s) => ({ kind: 'lens-profile', version: PROJECT_VERSION, printer: s.printer, media: s.media, lens: s.lens, tests: s.tests }),
  plan: (s, derived) => ({ kind: 'plan', version: PROJECT_VERSION, effect: s.effect, orientation: s.orientation, card: s.card, plan: s.plan, derived }),
};

export function applySlice(state, slice) {
  if (!slice || !slice.kind) throw new Error('Not a Lenticular Studio file.');
  const pick = {
    // Calibration only: an old profile's card / effect / orientation are ignored.
    'lens-profile': ['printer', 'media', 'lens', 'tests'],
    plan: ['effect', 'orientation', 'card', 'plan'],
    layers: ['layers'],
    animation: ['animation'],
    depth: ['depth'],
  }[slice.kind];
  if (!pick) throw new Error(`Unknown file kind "${slice.kind}".`);
  const partial = {};
  for (const k of pick) if (k in slice) partial[k] = JSON.parse(JSON.stringify(slice[k]));
  if (partial.lens) delete partial.lens.orientation;
  if (partial.printer) delete partial.printer.model;
  return normalizeState(deepMerge(state, partial));
}
