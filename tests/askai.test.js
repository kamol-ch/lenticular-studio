import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAskPrompt, AI_SITES, MAX_PROMPT_CHARS, HELP_URL } from '../js/core/askai.js';
import { defaultState } from '../js/core/schema.js';
import { computePlan } from '../js/core/planner.js';

const state = defaultState();
state.lens.lpiMeasured = 75.08;
state.printer.inkSpreadMm = 0.035;
const plan = computePlan({ ppi: 720, lpi: 75.08, frames: 8, viewingAngleDeg: null, card: state.card });

test('prompt carries the step, the help link, the settings and the question', () => {
  const p = buildAskPrompt({ step: { id: 2, title: 'Card & frame plan' }, state, plan, warnings: ['Weak 3D'], question: 'Why 1.5?' });
  assert.match(p, /Step 2 · Card & frame plan/);
  assert.ok(p.includes(HELP_URL));
  assert.match(p, /75\.08 measured; 9\.59 px per lens/);
  assert.match(p, /ink spread 0\.035 mm per edge/);
  assert.match(p, /frames between the eyes 2\.25/);
  assert.match(p, /- Weak 3D/);
  assert.match(p, /My question: Why 1\.5\?$/);
});

test('settings can be left out', () => {
  const p = buildAskPrompt({ step: { id: 1, title: 'Printer & lens' }, state, plan, warnings: ['x'], question: 'Hi', includeSettings: false });
  assert.doesNotMatch(p, /My settings|warnings/);
});

test('long warning lists are trimmed to keep the link short', () => {
  const many = Array.from({ length: 40 }, (_, i) => `Warning number ${i} with quite a lot of text to make it long enough`);
  const p = buildAskPrompt({ step: { id: 2, title: 'Plan' }, state, plan, warnings: many, question: 'q' });
  assert.ok(p.length <= MAX_PROMPT_CHARS, `length ${p.length}`);
  assert.match(p, /Warning number 0/);
});

test('AI links encode the prompt', () => {
  for (const s of AI_SITES) {
    const u = new URL(s.url('a b & c?'));
    assert.equal(u.searchParams.get('q'), 'a b & c?');
  }
});
