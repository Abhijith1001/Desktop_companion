// Writes the installer/branding assets into build/ from the code-drawn icon:
//   icon.ico    multi-size app + installer icon
//   icon.png    512px icon (electron-builder fallback, docs)
//   splash.bmp  installer splash (magenta = transparent for AdvSplash)
const fs = require('fs');
const path = require('path');
const { iconPng, iconPixels } = require('../electron/icon');

const OUT = path.join(__dirname, '..', 'build');
fs.mkdirSync(OUT, { recursive: true });

// ---- .ico with PNG-compressed entries (supported since Windows Vista)
function ico(sizes) {
  const images = sizes.map((s) => iconPng(s));
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // icon
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((s, i) => {
    const e = 6 + i * 16;
    header[e] = s >= 256 ? 0 : s;
    header[e + 1] = s >= 256 ? 0 : s;
    header.writeUInt16LE(1, e + 4);   // planes
    header.writeUInt16LE(32, e + 6);  // bpp
    header.writeUInt32LE(images[i].length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += images[i].length;
  });
  return Buffer.concat([header, ...images]);
}

// ---- splash: rounded card, paw tile and the name in a chunky pixel font
const GLYPHS = {
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

function splash() {
  const W = 400; const H = 300; const R = 28;
  const KEY = [255, 0, 255];
  const px = new Array(W * H);
  const set = (x, y, rgb) => { if (x >= 0 && y >= 0 && x < W && y < H) px[y * W + x] = rgb; };

  // Card: soft cream with a warm border; corners keyed out.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = Math.max(R - x, 0, x - (W - 1 - R));
      const dy = Math.max(R - y, 0, y - (H - 1 - R));
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > R) { set(x, y, KEY); continue; }
      const t = y / H;
      set(x, y, d > R - 3 ? [0xe8, 0x99, 0x4a] : [255, Math.round(250 - 8 * t), Math.round(243 - 18 * t)]);
    }
  }

  // Icon tile, blended over the card (no alpha in BMP).
  const S = 128; const ox = (W - S) / 2; const oy = 44;
  const icon = iconPixels(S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const o = (y * S + x) * 4; const a = icon[o + 3] / 255;
      const under = px[(oy + y) * W + ox + x];
      set(ox + x, oy + y, [0, 1, 2].map((i) => Math.round(icon[o + i] * a + under[i] * (1 - a))));
    }
  }

  // Title.
  const text = 'DESKTOP BUDDY'; const scale = 4; const ink = [0x4e, 0x2c, 0x12];
  const tw = text.length * 6 * scale - scale;
  let cx = Math.round((W - tw) / 2); const ty = oy + S + 34;
  for (const ch of text) {
    GLYPHS[ch].forEach((row, gy) => [...row].forEach((bit, gx) => {
      if (bit !== '1') return;
      for (let yy = 0; yy < scale; yy++) for (let xx = 0; xx < scale; xx++) set(cx + gx * scale + xx, ty + gy * scale + yy, ink);
    }));
    cx += 6 * scale;
  }

  // 24-bit BMP, bottom-up rows padded to 4 bytes.
  const rowSize = Math.ceil((W * 3) / 4) * 4;
  const data = Buffer.alloc(rowSize * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [r, g, b] = px[y * W + x];
      const o = (H - 1 - y) * rowSize + x * 3;
      data[o] = b; data[o + 1] = g; data[o + 2] = r;
    }
  }
  const head = Buffer.alloc(54);
  head.write('BM', 0);
  head.writeUInt32LE(54 + data.length, 2);
  head.writeUInt32LE(54, 10);
  head.writeUInt32LE(40, 14);
  head.writeInt32LE(W, 18);
  head.writeInt32LE(H, 22);
  head.writeUInt16LE(1, 26);
  head.writeUInt16LE(24, 28);
  head.writeUInt32LE(data.length, 34);
  return Buffer.concat([head, data]);
}

fs.writeFileSync(path.join(OUT, 'icon.ico'), ico([16, 20, 24, 32, 40, 48, 64, 128, 256]));
fs.writeFileSync(path.join(OUT, 'icon.png'), iconPng(512));
fs.writeFileSync(path.join(OUT, 'splash.bmp'), splash());
console.log('Wrote build/icon.ico, build/icon.png, build/splash.bmp');
