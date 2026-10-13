// JSON-lines log in <userData>/logs/app.log, rotated at 1 MB (3 files kept).
// Log task ids, never task titles/descriptions or credentials.
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 1_000_000;
const KEEP = 3;
let file = null;

function init(dir) {
  fs.mkdirSync(dir, { recursive: true });
  file = path.join(dir, 'app.log');
}

function rotate() {
  try {
    if (fs.statSync(file).size < MAX_BYTES) return;
    for (let i = KEEP - 1; i >= 1; i--) {
      const from = `${file}.${i}`;
      if (fs.existsSync(from)) fs.renameSync(from, `${file}.${i + 1}`);
    }
    fs.renameSync(file, `${file}.1`);
  } catch { /* file may not exist yet */ }
}

function write(level, msg, meta) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...meta });
  if (level === 'error') console.error(line);
  else if (process.env.BUDDY_DEBUG) console.log(line);
  if (!file) return;
  try {
    rotate();
    fs.appendFileSync(file, `${line}\n`);
  } catch { /* logging must never crash the app */ }
}

module.exports = {
  init,
  dir: () => (file ? path.dirname(file) : null),
  debug: (m, x) => process.env.BUDDY_DEBUG && write('debug', m, x),
  info: (m, x) => write('info', m, x),
  warn: (m, x) => write('warn', m, x),
  error: (m, x) => write('error', m, x),
};
