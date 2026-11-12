// Simple-motion effects (plan §5 Step 4b). Pure, DOM-free.
// Distances are in millimetres on the card; the renderer converts to pixels.

export const EASINGS = {
  linear: (t) => t,
  easeInOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  easeIn: (t) => t * t,
  easeOut: (t) => 1 - (1 - t) * (1 - t),
  sine: (t) => 0.5 - 0.5 * Math.cos(Math.PI * t),
};

export const EFFECT_TYPES = {
  drift:   { label: 'Drift',    unit: 'mm', defaultAmount: 1.5,  hasDirection: true,  hasCycles: false },
  bob:     { label: 'Bob',      unit: 'mm', defaultAmount: 0.4, hasDirection: true,  hasCycles: true },
  sway:    { label: 'Sway',     unit: '°',  defaultAmount: 4,  hasDirection: false, hasCycles: true },
  scale:   { label: 'Scale',    unit: '%',  defaultAmount: 8,  hasDirection: false, hasCycles: false },
  fadeIn:  { label: 'Fade in',  unit: '%',  defaultAmount: 100, hasDirection: false, hasCycles: false },
  fadeOut: { label: 'Fade out', unit: '%',  defaultAmount: 100, hasDirection: false, hasCycles: false },
  flicker: { label: 'Flicker',  unit: '%',  defaultAmount: 40, hasDirection: false, hasCycles: false },
};

export function newEffect(type = 'bob', target = null) {
  return {
    id: Math.random().toString(36).slice(2, 9),
    target, type,
    amount: EFFECT_TYPES[type].defaultAmount,
    angleDeg: type === 'drift' ? 0 : 90,
    easing: 'sine',
    cycles: 1,
    enabled: true,
  };
}

export function frameT(i, n) {
  return n <= 1 ? 0 : i / (n - 1);
}

function hash01(i, seed) {
  let x = (i * 374761393 + seed * 668265263) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967295;
}

function seedOf(id = '') {
  let s = 7;
  for (let i = 0; i < id.length; i++) s = (s * 31 + id.charCodeAt(i)) | 0;
  return s >>> 0;
}

/** Identity transform state. */
export const IDENTITY = Object.freeze({ dxMm: 0, dyMm: 0, scale: 1, rotateDeg: 0, opacity: 1 });

/** State contributed by one effect at frame i of n. */
export function effectState(effect, i, n) {
  const s = { ...IDENTITY };
  if (!effect || effect.enabled === false) return s;
  const ease = EASINGS[effect.easing] || EASINGS.linear;
  const t = frameT(i, n);
  const e = ease(t);
  const a = Number(effect.amount) || 0;
  const ang = ((effect.angleDeg ?? 0) * Math.PI) / 180;
  const cycles = Math.max(0.5, Number(effect.cycles) || 1);
  switch (effect.type) {
    case 'drift': {
      const d = a * (e - 0.5);
      s.dxMm = d * Math.cos(ang); s.dyMm = d * Math.sin(ang);
      break;
    }
    case 'bob': {
      const d = (a / 2) * Math.sin(2 * Math.PI * cycles * e);
      s.dxMm = d * Math.cos(ang); s.dyMm = d * Math.sin(ang);
      break;
    }
    case 'sway':
      s.rotateDeg = (a / 2) * Math.sin(2 * Math.PI * cycles * e);
      break;
    case 'scale':
      s.scale = 1 + (a / 100) * (e - 0.5);
      break;
    case 'fadeIn':
      s.opacity = 1 - (a / 100) * (1 - e);
      break;
    case 'fadeOut':
      s.opacity = 1 - (a / 100) * e;
      break;
    case 'flicker':
      s.opacity = 1 - (a / 100) * hash01(i, seedOf(effect.id));
      break;
  }
  return s;
}

export function combineStates(states) {
  const out = { ...IDENTITY };
  for (const s of states) {
    out.dxMm += s.dxMm; out.dyMm += s.dyMm;
    out.scale *= s.scale; out.rotateDeg += s.rotateDeg;
    out.opacity *= s.opacity;
  }
  out.opacity = Math.max(0, Math.min(1, out.opacity));
  return out;
}

export function stateForTarget(effects, target, i, n) {
  return combineStates(effects.filter((e) => e.target === target).map((e) => effectState(e, i, n)));
}

/** Largest translation between consecutive frames, in mm (for ghosting warnings). */
export function maxMotionMmPerFrame(effects, n) {
  let max = 0;
  const targets = [...new Set(effects.map((e) => e.target))];
  for (const tg of targets) {
    for (let i = 0; i + 1 < n; i++) {
      const a = stateForTarget(effects, tg, i, n);
      const b = stateForTarget(effects, tg, i + 1, n);
      max = Math.max(max, Math.hypot(b.dxMm - a.dxMm, b.dyMm - a.dyMm));
    }
  }
  return max;
}
