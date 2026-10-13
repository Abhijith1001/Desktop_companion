// Generates a paw-print PNG at runtime so the app needs no binary assets.
const zlib = require('zlib');
const { nativeImage } = require('electron');

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, body) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([len, typed, crc]);
}

function makeIcon(size = 32) {
  // [cx, cy, r] as fractions of size: main pad + four toes
  const blobs = [
    [0.5, 0.66, 0.24], [0.22, 0.42, 0.11], [0.39, 0.22, 0.11],
    [0.61, 0.22, 0.11], [0.78, 0.42, 0.11],
  ].map(([x, y, r]) => [x * size, y * size, r * size]);

  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size); // filter byte 0 per row, rest transparent
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inside = blobs.some(([cx, cy, r]) => (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r);
      if (!inside) continue;
      const o = y * stride + 1 + x * 4;
      raw[o] = 0xe8; raw[o + 1] = 0x99; raw[o + 2] = 0x4a; raw[o + 3] = 0xff;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return nativeImage.createFromBuffer(png);
}

module.exports = { makeIcon };
