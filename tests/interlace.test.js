import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameIndexAt, buildIndexMap, createInterlacer, planPage, visibleFrameAtAngle } from '../js/core/interlace.js';
import { scaleMarks } from '../js/core/scale.js';
import { bleedBoxPx, workingFrameSize, pitchPx, tileLayout } from '../js/core/geometry.js';

test('pitch 9.6 px, 8 frames: index per column matches hand-computed values', () => {
  // Column centres 0.5, 1.5, … ; phase = frac(c/9.6); k = floor(phase*8)
  const map = buildIndexMap(20, 9.6, 8);
  const expected = [];
  for (let x = 0; x < 20; x++) {
    const ph = ((x + 0.5) / 9.6) % 1;
    expected.push(Math.floor(ph * 8));
  }
  assert.deepEqual([...map], expected);
  // Spot checks: column 0 → phase .052 → 0; column 9 → .989 → 7; column 10 → .094 → 0
  assert.equal(map[0], 0);
  assert.equal(map[9], 7);
  assert.equal(map[10], 0);
});

test('every frame gets ≈ equal share of columns over many lenses', () => {
  const n = 8, pitch = 9.6, len = 9600;
  const counts = new Array(n).fill(0);
  for (const k of buildIndexMap(len, pitch, n)) counts[k]++;
  for (const c of counts) assert.ok(Math.abs(c - len / n) <= len / n * 0.02, `count ${c}`);
});

test('reverse flips the order within each lens', () => {
  for (let x = 0; x < 50; x++) {
    assert.equal(frameIndexAt(x, 9.6, 8, true), 7 - frameIndexAt(x, 9.6, 8, false));
  }
});

test('measured fractional pitch (75.08 LPI) stays in phase over the card', () => {
  const p = pitchPx(720, 75.08);
  // after exactly 100 lenses, the pattern repeats
  const x0 = 3;
  const x1 = Math.round(x0 + 100 * p);
  assert.ok(Math.abs(frameIndexAt(x0, p, 8) - frameIndexAt(x1, p, 8)) <= 1);
});

test('output dimensions match card size × ppi exactly', () => {
  const b = bleedBoxPx({ widthMm: 100, heightMm: 150, bleedMm: 3 }, 720);
  assert.equal(b.w, Math.round((106 / 25.4) * 720)); // 3005
  assert.equal(b.h, Math.round((156 / 25.4) * 720)); // 4422
  const b2 = bleedBoxPx({ widthMm: 25.4, heightMm: 25.4, bleedMm: 0 }, 720);
  assert.equal(b2.w, 720);
  assert.equal(b2.h, 720);
});

test('working frame size: ~3 samples per lens on the interlace axis', () => {
  const g = workingFrameSize({ card: { widthMm: 100, heightMm: 150, bleedMm: 3 }, ppi: 720, lpi: 75, orientation: 'vertical', samplesPerLens: 3 });
  assert.equal(g.fh, g.outH);
  assert.equal(g.fw, Math.ceil((g.outW / 9.6) * 3));
  const gh = workingFrameSize({ card: { widthMm: 100, heightMm: 150, bleedMm: 3 }, ppi: 720, lpi: 75, orientation: 'horizontal' });
  assert.equal(gh.fw, gh.outW);
  assert.ok(gh.fh < gh.outH);
});

function solidFrames(n, w, h) {
  return Array.from({ length: n }, (_, k) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) { data[i * 4] = k * 10; data[i * 4 + 1] = 0; data[i * 4 + 2] = 0; data[i * 4 + 3] = 255; }
    return { width: w, height: h, data };
  });
}

test('interlacer writes frame k into the columns mapped to k (vertical ridges)', () => {
  const frames = solidFrames(8, 30, 10);
  const il = createInterlacer({ frames, outW: 96, outH: 10, pitch: 9.6, orientation: 'vertical' });
  assert.equal(il.width, 96);
  assert.equal(il.height, 10);
  const row = new Uint8Array(96 * 3);
  il.renderRow(5, row);
  for (let x = 0; x < 96; x++) assert.equal(row[x * 3], frameIndexAt(x, 9.6, 8) * 10);
});

test('interlacer horizontal ridges: frame chosen per row', () => {
  const frames = solidFrames(4, 10, 30);
  const il = createInterlacer({ frames, outW: 10, outH: 48, pitch: 9.6, orientation: 'horizontal', reverse: true });
  const row = new Uint8Array(10 * 3);
  for (let y = 0; y < 48; y++) {
    il.renderRow(y, row);
    assert.equal(row[0], frameIndexAt(y, 9.6, 4, true) * 10);
  }
});

test('marks add a margin; registration strip uses frame-0 slots', () => {
  const frames = solidFrames(8, 30, 10);
  const il = createInterlacer({ frames, outW: 96, outH: 10, pitch: 9.6, marks: true, marginMm: 8, ppi: 720 });
  const m = Math.round((8 / 25.4) * 720);
  assert.equal(il.marginPx, m);
  assert.equal(il.width, 96 + 2 * m);
  assert.equal(il.height, 10 + 2 * m);
  const row = new Uint8Array(il.width * 3);
  il.renderRow(Math.round(m * 0.3), row); // inside top strip (distance ≈ 0.7 m from card)
  for (let lx = 0; lx < 96; lx++) {
    const x = m + lx;
    const black = il.indexMap[x] === 0;
    assert.equal(row[x * 3], black ? 0 : 255);
  }
});

const A4 = { widthMm: 210, heightMm: 297, marginMm: 3 };

test('A4 tiling fits multiple small cards and keeps one lens grid', () => {
  const out = bleedBoxPx({ widthMm: 54, heightMm: 85.6, bleedMm: 2 }, 720);
  const page = planPage({ outW: out.w, outH: out.h, marginPx: 100, tile: true, media: A4, ppi: 720 });
  assert.ok(page.placements.length >= 6, `got ${page.placements.length}`);
  const t = tileLayout(out.w + 200, out.h + 200, 720, A4);
  assert.equal(page.placements.length, t.cols * t.rows);
});

test('tilt simulator walks through frames across one viewing zone', () => {
  const seen = new Set();
  for (let a = -15.9; a < 16; a += 0.5) seen.add(visibleFrameAtAngle(a, 32, 8));
  assert.equal(seen.size, 8);
  assert.equal(visibleFrameAtAngle(0, 32, 8), 4);
});

test('scale marks: border on the sheet edge, 50 mm bar outer length exact', () => {
  const W = 2835, H = 4252; // 100 × 150 mm at 720 ppi
  const m = scaleMarks({ pageW: W, pageH: H, ppi: 720, barX: 300, barY: 4000 });
  assert.equal(m.barPx, Math.round((50 / 25.4) * 720)); // 1417 px = 50.0 mm
  const black = m.rects.filter((r) => r.v === 0);
  const xs = black.flatMap((r) => [r.x, r.x + r.w]), ys = black.flatMap((r) => [r.y, r.y + r.h]);
  assert.equal(Math.min(...xs), 0); assert.equal(Math.max(...xs), W);
  assert.equal(Math.min(...ys), 0); assert.equal(Math.max(...ys), H);
  // the two end ticks span exactly the bar length
  const ticks = black.filter((r) => r.h > r.w && r.h < H);
  assert.equal(Math.max(...ticks.map((r) => r.x + r.w)) - Math.min(...ticks.map((r) => r.x)), m.barPx);
});

test('interlacer overlay paints rectangles after the image', () => {
  const frames = solidFrames(2, 10, 10);
  const il = createInterlacer({ frames, outW: 20, outH: 10, pitch: 4, overlay: [{ x: 2, y: 3, w: 5, h: 2, v: 0 }] });
  const row = new Uint8Array(20 * 3);
  il.renderRow(4, row);
  for (let x = 0; x < 20; x++) if (x >= 2 && x < 7) assert.equal(row[x * 3], 0);
  // rows outside the rectangle are identical to an interlace without overlay
  const plain = createInterlacer({ frames, outW: 20, outH: 10, pitch: 4 });
  const a = new Uint8Array(20 * 3), b = new Uint8Array(20 * 3);
  il.renderRow(6, a); plain.renderRow(6, b);
  assert.deepEqual(a, b);
});
