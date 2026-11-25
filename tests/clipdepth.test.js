import { test } from 'node:test';
import assert from 'node:assert/strict';
import { temporalSmooth } from '../js/core/depthmap.js';
import { clipIndex, depthMapForFrame, perFrameDepth } from '../js/compose.js';
import { defaultState } from '../js/core/schema.js';

const map = (v, w = 2, h = 1) => ({ w, h, data: new Uint8Array(w * h).fill(v) });

test('temporal smoothing mixes neighbours and keeps ends sensible', () => {
  const out = temporalSmooth([map(0), map(100), map(200)], 0.5);
  assert.equal(out[0].data[0], Math.round((0 + 0.5 * 100) / 1.5)); // 33
  assert.equal(out[1].data[0], Math.round((100 + 0.5 * 0 + 0.5 * 200) / 2)); // 100
  assert.equal(out[2].data[0], Math.round((200 + 0.5 * 100) / 1.5)); // 167
});

test('temporal smoothing skips missing or differently sized neighbours and does not mutate', () => {
  const a = map(10), c = map(50, 3, 1);
  const out = temporalSmooth([a, null, c], 0.5);
  assert.equal(out[1], null);
  assert.deepEqual([...out[0].data], [10, 10]);
  assert.notEqual(out[0].data, a.data);
});

test('clip index spreads output frames over the clip', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((i) => clipIndex(i, 8, 8)), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual([0, 1, 2, 3].map((i) => clipIndex(i, 4, 7)), [0, 2, 4, 6]);
  assert.equal(clipIndex(3, 1, 5), 0);
});

test('each output frame uses its clip frame map, falling back to the single map', () => {
  const state = defaultState();
  state.depth.mode = 'ai';
  state.animation.mode = 'clip';
  const single = map(1);
  const per = [map(10), null, map(30)];
  const assets = { animFrames: [{}, {}, {}], layerImages: {}, clipDepthMaps: per, depthMap: single };
  assert.equal(perFrameDepth(state, assets), false);
  assert.equal(depthMapForFrame(state, assets, 2, 3), single);
  state.depth.perClipFrame = true;
  assert.equal(perFrameDepth(state, assets), true);
  assert.equal(depthMapForFrame(state, assets, 0, 3), per[0]);
  assert.equal(depthMapForFrame(state, assets, 1, 3), single);
  assert.equal(depthMapForFrame(state, assets, 2, 3), per[2]);
});
