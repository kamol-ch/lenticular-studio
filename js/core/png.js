// Minimal PNG writer with pHYs (print size) support. Pure, DOM-free.
// Uses CompressionStream('deflate') (zlib format, as PNG IDAT requires), which
// is available in modern browsers, workers and Node ≥ 18.

const SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes, crc = 0xffffffff) {
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return crc;
}

function makeChunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const c = crc32(data, crc32(out.subarray(4, 8))) ^ 0xffffffff;
  dv.setUint32(8 + data.length, c >>> 0);
  return out;
}

export function ppiToPpm(ppi) {
  return Math.round(ppi / 0.0254);
}

export function pHYsChunk(ppi) {
  const d = new Uint8Array(9);
  const dv = new DataView(d.buffer);
  const ppm = ppiToPpm(ppi);
  dv.setUint32(0, ppm);
  dv.setUint32(4, ppm);
  d[8] = 1; // unit: metre
  return makeChunk('pHYs', d);
}

function ihdrChunk(width, height, colorType) {
  const d = new Uint8Array(13);
  const dv = new DataView(d.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  d[8] = 8; // bit depth
  d[9] = colorType; // 2 = RGB, 6 = RGBA
  d[10] = 0; d[11] = 0; d[12] = 0;
  return makeChunk('IHDR', d);
}

/**
 * Stream-encode a PNG row by row so huge outputs never need a full-size canvas.
 * @param {object} o
 * @param {number} o.width
 * @param {number} o.height
 * @param {number} [o.channels=3] 3 (RGB) or 4 (RGBA)
 * @param {number} [o.ppi] embed print resolution
 * @param {(y:number, row:Uint8Array)=>void} o.getRow fill `row` (width×channels bytes)
 * @param {'none'|'sub'|'up'} [o.filter='up']
 * @param {(fraction:number)=>void} [o.onProgress]
 * @returns {Promise<Blob>}
 */
export async function encodePng({ width, height, channels = 3, ppi, getRow, filter = 'up', onProgress }) {
  const bpp = channels;
  const stride = width * bpp;
  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  const compressed = new Response(cs.readable).arrayBuffer();

  let prev = new Uint8Array(stride);
  let cur = new Uint8Array(stride);
  const filterByte = filter === 'sub' ? 1 : filter === 'up' ? 2 : 0;
  const BATCH_BYTES = 1 << 20;
  const rowsPerBatch = Math.max(1, Math.floor(BATCH_BYTES / (stride + 1)));
  let batch = new Uint8Array(rowsPerBatch * (stride + 1));
  let bi = 0;

  for (let y = 0; y < height; y++) {
    getRow(y, cur);
    const o = bi * (stride + 1);
    batch[o] = filterByte;
    if (filterByte === 0) {
      batch.set(cur, o + 1);
    } else if (filterByte === 1) {
      for (let i = 0; i < bpp; i++) batch[o + 1 + i] = cur[i];
      for (let i = bpp; i < stride; i++) batch[o + 1 + i] = (cur[i] - cur[i - bpp]) & 0xff;
    } else {
      for (let i = 0; i < stride; i++) batch[o + 1 + i] = (cur[i] - prev[i]) & 0xff;
    }
    bi++;
    if (bi === rowsPerBatch || y === height - 1) {
      await writer.write(batch.slice(0, bi * (stride + 1)));
      bi = 0;
      if (onProgress) onProgress((y + 1) / height);
    }
    const t = prev; prev = cur; cur = t;
  }
  await writer.close();
  const idat = new Uint8Array(await compressed);

  const parts = [SIGNATURE, ihdrChunk(width, height, channels === 4 ? 6 : 2)];
  if (ppi) parts.push(pHYsChunk(ppi));
  const CHUNK = 1 << 22;
  for (let i = 0; i < idat.length; i += CHUNK) parts.push(makeChunk('IDAT', idat.subarray(i, i + CHUNK)));
  parts.push(makeChunk('IEND', new Uint8Array(0)));
  return new Blob(parts, { type: 'image/png' });
}

/** List chunks of a PNG byte array. */
export function readChunks(bytes) {
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIGNATURE[i]) throw new Error('Not a PNG file.');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks = [];
  let p = 8;
  while (p + 8 <= bytes.length) {
    const len = dv.getUint32(p);
    const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
    chunks.push({ type, start: p, end: p + 12 + len, data: bytes.subarray(p + 8, p + 8 + len) });
    p += 12 + len;
    if (type === 'IEND') break;
  }
  return chunks;
}

export function readPngInfo(bytes) {
  const chunks = readChunks(bytes);
  const ihdr = chunks.find((c) => c.type === 'IHDR');
  const dv = new DataView(ihdr.data.buffer, ihdr.data.byteOffset, ihdr.data.byteLength);
  const info = { width: dv.getUint32(0), height: dv.getUint32(4), colorType: ihdr.data[9], ppi: null };
  const phys = chunks.find((c) => c.type === 'pHYs');
  if (phys && phys.data[8] === 1) {
    const pdv = new DataView(phys.data.buffer, phys.data.byteOffset, phys.data.byteLength);
    info.ppi = pdv.getUint32(0) * 0.0254;
  }
  return info;
}

/** Insert or replace the pHYs chunk (e.g. on canvas.toBlob output). */
export async function setPngDpi(input, ppi) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(await input.arrayBuffer());
  const chunks = readChunks(bytes);
  const parts = [SIGNATURE];
  for (const c of chunks) {
    if (c.type === 'pHYs') continue;
    parts.push(bytes.subarray(c.start, c.end));
    if (c.type === 'IHDR') parts.push(pHYsChunk(ppi));
  }
  return new Blob(parts, { type: 'image/png' });
}
