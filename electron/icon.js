// The app icon: a white paw on a rounded orange tile, drawn in code so the
// runtime needs no binary assets. scripts/make-icons.js uses the same drawing
// for the installer's .ico and splash.
const zlib = require('zlib');

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

// Paw shapes in unit coordinates (0..1): main pad + four toes, as ellipses [cx, cy, rx, ry].
const PAW = [
  [0.5, 0.64, 0.2, 0.17],
  [0.25, 0.43, 0.075, 0.095], [0.4, 0.29, 0.08, 0.1],
  [0.6, 0.29, 0.08, 0.1], [0.75, 0.43, 0.075, 0.095],
];
const inPaw = (u, v) => PAW.some(([cx, cy, rx, ry]) => ((u - cx) / rx) ** 2 + ((v - cy) / ry) ** 2 <= 1);

// Rounded square with corner radius r (unit coordinates).
function inTile(u, v, r = 0.22) {
  const dx = Math.max(r - u, 0, u - (1 - r));
  const dy = Math.max(r - v, 0, v - (1 - r));
  return dx * dx + dy * dy <= r * r;
}

const TOP = [0xf7, 0xb7, 0x6e];
const BOTTOM = [0xd5, 0x70, 0x26];
const PAW_RGB = [0xff, 0xfb, 0xf5];

// RGBA pixels for a size×size icon, 4×4 supersampled for smooth edges.
function iconPixels(size, { tile = true } = {}) {
  const px = Buffer.alloc(size * size * 4);
  const S = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bg = 0; let paw = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const u = (x + (sx + 0.5) / S) / size;
          const v = (y + (sy + 0.5) / S) / size;
          if (!tile || inTile(u, v)) bg++;
          // Inset the paw a little so it sits comfortably inside the tile.
          if (inPaw(0.5 + (u - 0.5) / 0.92, 0.47 + (v - 0.5) / 0.92)) paw++;
        }
      }
      const t = y / Math.max(1, size - 1);
      const back = TOP.map((c, i) => c + (BOTTOM[i] - c) * t);
      const pa = paw / (S * S);
      const o = (y * size + x) * 4;
      if (tile) {
        for (let i = 0; i < 3; i++) px[o + i] = Math.round(back[i] * (1 - pa) + PAW_RGB[i] * pa);
        px[o + 3] = Math.round((bg / (S * S)) * 255);
      } else {
        for (let i = 0; i < 3; i++) px[o + i] = PAW_RGB[i];
        px[o + 3] = Math.round(pa * 255);
      }
    }
  }
  return px;
}

function encodePng(rgba, width, height = width) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height); // filter byte 0 per row
  for (let y = 0; y < height; y++) rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const iconPng = (size) => encodePng(iconPixels(size), size);

// Native image with crisp 1x and 2x versions (tray, window and taskbar icons).
function makeIcon(size = 32) {
  const { nativeImage } = require('electron');
  const img = nativeImage.createFromBuffer(iconPng(size));
  img.addRepresentation({ scaleFactor: 2, width: size, height: size, dataURL: `data:image/png;base64,${iconPng(size * 2).toString('base64')}` });
  return img;
}

module.exports = { makeIcon, iconPng, iconPixels, encodePng };
