import fs from 'node:fs';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
const png = fs.readFileSync('icon-512.png');
assert.equal(png.readUInt32BE(16), 512);
assert.equal(png.readUInt32BE(20), 512);
assert.equal(png[24], 8);
assert.equal(png[25], 6);
const chunks = [];
for (let p = 8; p < png.length;) {
  const n = png.readUInt32BE(p);
  if (png.toString('ascii', p + 4, p + 8) === 'IDAT') chunks.push(png.subarray(p + 8, p + 8 + n));
  p += n + 12;
}
const source = zlib.inflateSync(Buffer.concat(chunks));
const stride = 2049;
assert.equal(source.length, stride * 512);
for (let y = 0; y < 512; y++) assert.equal(source[y * stride], 0, 'Expected unfiltered generated PNG');
const raw = Buffer.alloc(stride * 512);
for (let y = 0; y < 512; y++) {
  for (let x = 0; x < 512; x++) {
    const p = y * stride + 1 + x * 4;
    raw.set([5, 150, 105, 255], p);
    if (x >= 96 && x < 416 && y >= 96 && y < 416) {
      const sx = Math.floor((x - 96) * 512 / 320);
      const sy = Math.floor((y - 96) * 512 / 320);
      const q = sy * stride + 1 + sx * 4;
      source.copy(raw, p, q, q + 4);
    }
  }
}
function chunk(type, data) {
  const t = Buffer.from(type);
  const payload = Buffer.concat([t, data]);
  let c = 0xffffffff;
  for (const byte of payload) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  payload.copy(out, 4);
  out.writeUInt32BE((c ^ 0xffffffff) >>> 0, out.length - 4);
  return out;
}
fs.writeFileSync('icon-maskable-512.png', Buffer.concat([
  png.subarray(0, 8), chunk('IHDR', png.subarray(16, 29)),
  chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
]));
