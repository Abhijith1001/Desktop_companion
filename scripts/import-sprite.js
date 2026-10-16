#!/usr/bin/env node
// Turns AI-made character poses into a sprite character for the pet.
//
//   node scripts/import-sprite.js <id> <folder> [--fps 24] [--height 260] [--similarity 0.12]
//
// <folder> holds one file per pose, named by pose: idle.png, walk.mp4,
// happy.mp4, warn.png, angry.png (PNG/JPG images or MP4/MOV/WEBM clips) on a
// plain light background. Each pose is written as an animated WebP with the
// background colour keyed out to electron/pet/public/sprites/<id>/. Needs ffmpeg on PATH
// (winget install Gyan.FFmpeg). For cleaner edges, cut the background out
// beforehand (e.g. rembg) and supply transparent PNG/WEBM files: keying then
// leaves them alone.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const POSES = ['idle', 'walk', 'held', 'fall', 'land', 'happy', 'warn', 'angry'];
const VIDEO = ['.mp4', '.mov', '.webm', '.mkv', '.gif'];
const IMAGE = ['.png', '.jpg', '.jpeg', '.webp'];

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return def;
  const [, v] = args.splice(i, 2);
  return Number(v);
};
const fps = opt('fps', 24);
const height = opt('height', 260);
const similarity = opt('similarity', 0.12);

// AI video backgrounds are rarely pure white: sample the top-left corner of
// the first frame and key out that colour instead.
function backgroundColor(src) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', src, '-vf', 'crop=iw/12:ih/12:0:0,scale=1:1',
    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  if (r.status !== 0 || r.stdout.length < 3) return 'white';
  return `0x${[...r.stdout.subarray(0, 3)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
const [id, folder] = args;
if (!id || !folder || !/^[a-z][a-z0-9-]*$/.test(id)) {
  console.error('Usage: node scripts/import-sprite.js <id: lowercase letters/digits> <folder> [--fps 24] [--height 260] [--similarity 0.12]');
  process.exit(1);
}
if (spawnSync('ffmpeg', ['-version']).status !== 0) {
  console.error('ffmpeg not found. Install it with: winget install Gyan.FFmpeg (then open a new terminal).');
  process.exit(1);
}

const out = path.join(__dirname, '..', 'electron', 'pet', 'public', 'sprites', id);
fs.mkdirSync(out, { recursive: true });
const files = fs.readdirSync(folder);
const found = {};

for (const pose of POSES) {
  const file = files.find((f) => path.parse(f).name.toLowerCase() === pose
    && [...VIDEO, ...IMAGE].includes(path.extname(f).toLowerCase()));
  if (!file) continue;
  const src = path.join(folder, file);
  const isVideo = VIDEO.includes(path.extname(file).toLowerCase());
  const dest = path.join(out, `${pose}.webp`);
  const filter = [
    `colorkey=${backgroundColor(src)}:${similarity}:0.08`,
    isVideo ? `fps=${fps}` : null,
    `scale=-2:${height}:flags=lanczos`,
    'format=yuva420p',
    // Wipe the faint leftovers of an uneven background so no box shows.
    "lut=a='if(lt(val,90),0,val)'",
  ].filter(Boolean).join(',');
  // Clips loop forever except the one-shot reactions, which hold their last frame.
  const loop = ['idle', 'walk', 'held', 'fall'].includes(pose) ? '0' : '1';
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf', filter, '-an',
    '-c:v', 'libwebp_anim', '-lossless', '0', '-quality', '80', '-loop', isVideo ? loop : '0', dest],
  { stdio: 'inherit' });
  if (r.status !== 0) { console.error(`  ${pose}: ffmpeg failed`); continue; }
  found[pose] = `${pose}.webp`;
  console.log(`  ${pose}: ${file} -> ${path.relative(process.cwd(), dest)} (${Math.round(fs.statSync(dest).size / 1024)} KB)`);
}

if (!found.idle) {
  console.error('No idle pose found: the folder needs at least idle.png (or idle.mp4).');
  process.exit(1);
}
const missing = POSES.filter((p) => !found[p]);
if (missing.length) console.log(`Missing poses (idle is used instead): ${missing.join(', ')}`);

console.log(`
Done. Register the character in electron/pet/characters.js (inside window.CHARACTERS):

  ${id}: {
    name: '${id[0].toUpperCase()}${id.slice(1)}',
    upright: true,
    sprite: { ${Object.entries(found).map(([k, v]) => `${k}: '${v}'`).join(', ')} },
  },
`);
