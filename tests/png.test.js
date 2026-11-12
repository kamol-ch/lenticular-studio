import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { encodePng, readChunks, readPngInfo, setPngDpi, crc32 } from '../js/core/png.js';

function unfilter(raw, width, height, bpp) {
  const stride = width * bpp;
  const out = new Uint8Array(stride * height);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const f = raw[p++];
    for (let i = 0; i < stride; i++) {
      const v = raw[p++];
      const left = i >= bpp ? out[y * stride + i - bpp] : 0;
      const up = y > 0 ? out[(y - 1) * stride + i] : 0;
      out[y * stride + i] = (v + (f === 1 ? left : f === 2 ? up : 0)) & 0xff;
    }
  }
  return out;
}

for (const filter of ['none', 'sub', 'up']) {
  test(`encodePng round-trips pixels (filter=${filter}) and embeds 720 ppi`, async () => {
    const width = 37, height = 23;
    const gen = (x, y, c) => (x * 7 + y * 13 + c * 51) & 0xff;
    const blob = await encodePng({
      width, height, ppi: 720, filter,
      getRow: (y, row) => { for (let x = 0; x < width; x++) for (let c = 0; c < 3; c++) row[x * 3 + c] = gen(x, y, c); },
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const info = readPngInfo(bytes);
    assert.equal(info.width, width);
    assert.equal(info.height, height);
    assert.ok(Math.abs(info.ppi - 720) < 0.05, `ppi ${info.ppi}`);
    const chunks = readChunks(bytes);
    // CRCs valid
    for (const c of chunks) {
      const dv = new DataView(bytes.buffer, bytes.byteOffset);
      const stored = dv.getUint32(c.end - 4);
      const calc = (crc32(bytes.subarray(c.start + 4, c.end - 4)) ^ 0xffffffff) >>> 0;
      assert.equal(stored, calc, `crc ${c.type}`);
    }
    const idat = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => Buffer.from(c.data)));
    const px = unfilter(inflateSync(idat), width, height, 3);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < 3; c++) {
      assert.equal(px[(y * width + x) * 3 + c], gen(x, y, c));
    }
  });
}

test('setPngDpi replaces an existing pHYs chunk', async () => {
  const blob = await encodePng({ width: 2, height: 2, ppi: 300, getRow: (y, r) => r.fill(9) });
  const fixed = await setPngDpi(blob, 1440);
  const bytes = new Uint8Array(await fixed.arrayBuffer());
  const chunks = readChunks(bytes);
  assert.equal(chunks.filter((c) => c.type === 'pHYs').length, 1);
  assert.equal(chunks[1].type, 'pHYs');
  assert.ok(Math.abs(readPngInfo(bytes).ppi - 1440) < 0.05);
});
