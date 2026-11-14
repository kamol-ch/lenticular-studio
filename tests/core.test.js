import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePlan, eyeAngleDeg, depthUsage } from '../js/core/planner.js';
import { effectState, maxMotionMmPerFrame, newEffect, stateForTarget } from '../js/core/motion.js';
import { forwardWarp, layerShiftPx, viewGain } from '../js/core/warp.js';
import { applyBrush, boxBlur, createDepthMap, dilate, resampleToSigned } from '../js/core/depthmap.js';
import { estimateShift, frameOrder, evenlySpacedTimes, resampleIndex } from '../js/core/sequence.js';
import { defaultState, normalizeState, serializeState, applySlice, SLICES } from '../js/core/schema.js';
import { testSheetMm } from '../js/core/geometry.js';

const card = { widthMm: 100, heightMm: 150, bleedMm: 3 };

test('planner: 720 ppi / 75 LPI defaults', () => {
  const p = computePlan({ ppi: 720, lpi: 75, frames: 8, viewingAngleDeg: 32, card });
  assert.ok(Math.abs(p.pitchPx - 9.6) < 1e-9);
  assert.equal(p.maxFrames, 9);
  assert.ok(Math.abs(eyeAngleDeg() - 9.0) < 0.1);
  assert.ok(Math.abs(p.framesBetweenEyes - (eyeAngleDeg() * 8) / 32) < 1e-9);
  assert.ok(Math.abs(p.maxShiftPxPerFrame - 9.6) < 1e-9);
  assert.ok(!p.warnings.some((w) => w.level === 'error'));
});

test('planner warnings: weak 3D, too many frames, blur', () => {
  const weak = computePlan({ ppi: 720, lpi: 75, frames: 4, viewingAngleDeg: 40, card });
  assert.ok(weak.warnings.some((w) => w.code === 'weak-3d'));
  const many = computePlan({ ppi: 720, lpi: 75, frames: 12, viewingAngleDeg: 32, card });
  assert.ok(many.warnings.some((w) => w.code === 'too-many-frames'));
  const blur = computePlan({ ppi: 720, lpi: 75, frames: 8, viewingAngleDeg: 32, card,
    depth: { mode: 'layers', keyPlane: 0, strength: 1, layers: [{ depth: -1 }, { depth: 1.5 }] } });
  assert.ok(blur.warnings.some((w) => w.code === 'blur-risk'));
  assert.equal(depthUsage({ mode: 'ai', keyPlane: 0, strength: 0.5 }, 10).pxPerFrame, 5);
});

test('motion: drift spans amount across frames, bob returns to start', () => {
  const d = { ...newEffect('drift', 'a'), amount: 4, easing: 'linear', angleDeg: 0 };
  assert.ok(Math.abs(effectState(d, 0, 8).dxMm + 2) < 1e-9);
  assert.ok(Math.abs(effectState(d, 7, 8).dxMm - 2) < 1e-9);
  const b = { ...newEffect('bob', 'a'), amount: 2, easing: 'linear', angleDeg: 90 };
  assert.ok(Math.abs(effectState(b, 0, 8).dyMm) < 1e-9);
  assert.ok(Math.abs(effectState(b, 7, 8).dyMm) < 1e-9);
  const f = { ...newEffect('fadeIn', 'a'), easing: 'linear' };
  assert.equal(effectState(f, 0, 5).opacity, 0);
  assert.equal(effectState(f, 4, 5).opacity, 1);
  assert.ok(Math.abs(maxMotionMmPerFrame([d], 8) - 4 / 7) < 1e-9);
  assert.equal(stateForTarget([d], 'other', 3, 8).dxMm, 0);
});

test('warp: zero gain is identity; near object moves opposite to far', () => {
  const w = 20, h = 2;
  const src = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { src[i * 4] = i % w; src[i * 4 + 3] = 255; }
  const depth = new Float32Array(w * h);
  assert.deepEqual(forwardWarp({ src, depth, width: w, height: h, gain: 0 }), src);
  // near block in the middle at depth 1, background at −1
  for (let y = 0; y < h; y++) for (let x = 8; x < 12; x++) { depth[y * w + x] = 1; src[(y * w + x) * 4] = 200; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (depth[y * w + x] === 0) depth[y * w + x] = -1;
  const out = forwardWarp({ src, depth, width: w, height: h, gain: 2 });
  // near (+1) moves by −2, far (−1) by +2 → block now at 6..9
  for (let x = 6; x < 10; x++) assert.equal(out[x * 4], 200, `x=${x}`);
  // no holes: every pixel opaque
  for (let i = 0; i < w * h; i++) assert.equal(out[i * 4 + 3], 255);
  assert.equal(layerShiftPx(1, 0, 1, 10, 0, 3), 10);
  assert.equal(viewGain(1, 3, 1, 10), 0);
});

test('depthmap: brush, blur, dilate, resample', () => {
  const m = createDepthMap(21, 21, 100);
  applyBrush(m, 10, 10, 5, 1, 'near');
  assert.ok(m.data[10 * 21 + 10] > 100);
  assert.equal(m.data[0], 100);
  const d = createDepthMap(9, 1, 0); d.data[4] = 255;
  dilate(d, 2);
  assert.deepEqual([...d.data], [0, 0, 255, 255, 255, 255, 255, 0, 0]);
  const b = createDepthMap(5, 5, 50); boxBlur(b, 2);
  assert.ok(b.data.every((v) => v === 50));
  const s = resampleToSigned(createDepthMap(4, 4, 255), 8, 8);
  assert.ok(s.every((v) => Math.abs(v - 1) < 1e-6));
});

test('sequence: ping-pong order and even spacing', () => {
  assert.deepEqual(frameOrder(8, true), { extract: 5, order: [0, 1, 2, 3, 4, 3, 2, 1] });
  assert.equal(frameOrder(9, true).order.length, 9);
  assert.deepEqual(frameOrder(4, false).order, [0, 1, 2, 3]);
  assert.deepEqual(evenlySpacedTimes(1, 3, 3), [1, 2, 3]);
  assert.equal(resampleIndex(7, 8, 4), 3);
});

test('sequence: estimateShift recovers a known translation', () => {
  const w = 64, h = 48;
  const img = (ox, oy) => {
    const g = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = Math.sin((x - ox) * 0.3) * 50 + Math.cos((y - oy) * 0.25) * 50 + ((x - ox) * (y - oy) % 17);
    return g;
  };
  const ref = img(0, 0), moved = img(3, -2);
  assert.deepEqual(estimateShift(ref, moved, w, h, 6, 1), { dx: -3, dy: 2 });
});

test('schema: round-trip and slices', () => {
  const s = defaultState();
  s.lens.lpiMeasured = 75.08;
  s.layers.push({ id: 'bg', name: 'bg', file: 'source/bg.png', x: 0.5, y: 0.5, scale: 1, opacity: 1, visible: true, depth: -1 });
  const back = normalizeState(serializeState(s));
  assert.deepEqual(back, s);
  // missing fields filled from defaults
  const partial = normalizeState({ version: 1, card: { widthMm: 54 } });
  assert.equal(partial.card.heightMm, 150);
  assert.equal(partial.card.widthMm, 54);
  // lens slice applies only lens/printer/card
  const lensSlice = JSON.parse(JSON.stringify(SLICES.lens(s)));
  const target = defaultState();
  target.plan.frames = 6;
  const applied = applySlice(target, lensSlice);
  assert.equal(applied.lens.lpiMeasured, 75.08);
  assert.equal(applied.plan.frames, 6);
  assert.throws(() => normalizeState({ version: 99 }));
});

test('schema: migrates projects that kept orientation on the lens and tiled on A4', () => {
  const old = { version: 1, effect: 'animation', lens: { lpiNominal: 75, orientation: 'horizontal' }, printer: { ppi: 720, model: 'X' }, interlace: { tileOnA4: true } };
  const s = normalizeState(old);
  assert.equal(s.orientation, 'horizontal');
  assert.equal('orientation' in s.lens, false);
  assert.equal(s.interlace.tileOnMedia, true);
  assert.equal('tileOnA4' in s.interlace, false);
  assert.equal('model' in s.printer, false);
  assert.equal(s.media.name, 'A4');
  // An old lens profile must not overwrite the card design.
  const target = defaultState();
  target.orientation = 'vertical';
  target.card.widthMm = 54;
  const applied = applySlice(target, { kind: 'lens-profile', lens: { lpiNominal: 75, lpiMeasured: 75.1, orientation: 'horizontal' }, card: { widthMm: 999 }, effect: 'animation' });
  assert.equal(applied.lens.lpiMeasured, 75.1);
  assert.equal(applied.orientation, 'vertical');
  assert.equal(applied.card.widthMm, 54);
  assert.equal(applied.effect, '3d');
});

test('geometry: test sheet follows the lens sheet, turned and clamped to the paper', () => {
  const a4 = { widthMm: 210, heightMm: 297, marginMm: 3 };
  assert.deepEqual(testSheetMm({}, a4), { w: 100, h: 150 });
  assert.deepEqual(testSheetMm({ sheetWidthMm: 300, sheetHeightMm: 200 }, a4), { w: 200, h: 291 });
  const land = { widthMm: 152.4, heightMm: 101.6, marginMm: 3 };
  assert.deepEqual(testSheetMm({}, land), { w: 146.4, h: 95.6 });
});
