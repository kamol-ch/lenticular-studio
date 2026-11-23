// "Ask AI" prompt builder (pure, DOM-free). The app never calls an AI itself:
// it opens the user's own AI site with this text pre-filled.

import { lpiInUse, pitchPx } from './geometry.js';

export const HELP_URL = 'https://raw.githubusercontent.com/kamol-ch/lenticular-studio/main/docs/HELP.md';
export const REPO_URL = 'https://github.com/kamol-ch/lenticular-studio';

/** Keep pre-filled links comfortably inside URL length limits. */
export const MAX_PROMPT_CHARS = 1800;

/** AI sites that accept a pre-filled prompt in the URL (unofficial but widely used). */
export const AI_SITES = [
  { id: 'claude', name: 'Claude', url: (q) => `https://claude.ai/new?q=${encodeURIComponent(q)}` },
  { id: 'chatgpt', name: 'ChatGPT', url: (q) => `https://chatgpt.com/?q=${encodeURIComponent(q)}` },
  { id: 'perplexity', name: 'Perplexity', url: (q) => `https://www.perplexity.ai/search/new?q=${encodeURIComponent(q)}` },
];

/** Example questions per step, used as the input placeholder. */
export const EXAMPLE_QUESTIONS = {
  1: 'How do I read the pitch test? Which band is the right one?',
  2: 'How is "frames between the eyes" calculated, and how many frames should I use?',
  3: 'How should I prepare my watercolor scan as layers for 3D?',
  4: 'My animation ghosts through the lens. What should I change?',
  5: 'What does the depth budget do, and why are far objects blurry?',
  6: 'The 3D looks inside-out. What should I change?',
  7: 'How do I line the lens up with the print?',
};

const n = (v, d = 2) => (Number.isFinite(v) ? +v.toFixed(d) : '?');

/** One line per group of settings that matter for answers. */
export function settingsLines(state, plan) {
  const lpi = lpiInUse(state.lens);
  const lines = [
    `Printer ${state.printer.ppi} ppi; lens ${state.lens.lpiNominal} LPI nominal${state.lens.lpiMeasured ? `, ${state.lens.lpiMeasured} measured` : ' (not measured)'}; ${n(pitchPx(state.printer.ppi, lpi), 3)} px per lens.`,
    `Viewing angle ${state.lens.angleDeg ? `${state.lens.angleDeg}° measured` : '32° assumed (not measured)'}; ink spread ${state.printer.inkSpreadMm ? `${state.printer.inkSpreadMm} mm per edge` : 'not set'}; paper ${state.media.name || `${state.media.widthMm} × ${state.media.heightMm} mm`}.`,
    `Card ${state.card.widthMm} × ${state.card.heightMm} mm + ${state.card.bleedMm} mm bleed; effect ${state.effect}; ridges ${state.orientation}.`,
  ];
  if (plan) {
    lines.push(`${state.plan.frames} frames (strip ${n(plan.stripPx)} px, max ${plan.maxFrames}); frames between the eyes ${n(plan.framesBetweenEyes)}; depth budget ${state.plan.budgetLensPerFrame} lens/frame; viewing distance ${state.plan.viewDistMm} mm.`);
  }
  const extras = [];
  if (state.animation.mode !== 'none') extras.push(`animation: ${state.animation.mode}`);
  if (state.depth.mode !== 'none') extras.push(`depth: ${state.depth.mode} (strength ${state.depth.strength}, key plane ${state.depth.keyPlane})`);
  extras.push(`smooth strip edges ${state.interlace.smoothEdges === false ? 'off' : 'on'}`, `reverse order ${state.interlace.reverse ? 'on' : 'off'}`);
  lines.push(`${extras.join('; ')}.`);
  return lines;
}

/**
 * The full prompt. Warnings are dropped from the end first if it gets too long.
 * @param {{ step:{id:number,title:string}, state:object, plan?:object, warnings?:string[], question?:string, includeSettings?:boolean }} o
 */
export function buildAskPrompt({ step, state, plan = null, warnings = [], question = '', includeSettings = true }) {
  const q = question.trim() || '(I will type my question here.)';
  const make = (ws) => [
    `I'm using Lenticular Card Studio, a free browser tool for printing lenticular cards (${REPO_URL}).`,
    `Please read its help file with all formulas and troubleshooting first: ${HELP_URL}`,
    `Answer based on how this tool calculates things, show the numbers with my settings, and keep it practical.`,
    '',
    `I'm on Step ${step.id} · ${step.title}.`,
    ...(includeSettings && state ? ['My settings:', ...settingsLines(state, plan).map((l) => `- ${l}`)] : []),
    ...(includeSettings && ws.length ? ['The tool shows these warnings:', ...ws.map((w) => `- ${w}`)] : []),
    '',
    `My question: ${q}`,
  ].join('\n');
  let ws = [...new Set(warnings.map((w) => w.trim()).filter(Boolean))];
  let text = make(ws);
  while (text.length > MAX_PROMPT_CHARS && ws.length) { ws = ws.slice(0, -1); text = make(ws); }
  return text;
}
