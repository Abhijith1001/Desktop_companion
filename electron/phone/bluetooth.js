// Phone notifications over Bluetooth, from the Buddy Link Android app (see
// android/). bt-bridge.ps1 does the Bluetooth part with Windows' own sockets;
// this runs it, keeps the latest list and restarts it if it dies.
// Nothing is stored or sent anywhere; the list lives in memory.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { createFileTransfers } = require('./files');

const RESTART_MS = 10_000;

// One bridge line → parsed message, or null for anything that isn't ours.
function parseLine(line) {
  const s = String(line).trim();
  if (!s.startsWith('{')) return null;
  try {
    const msg = JSON.parse(s);
    return msg && typeof msg.t === 'string' ? msg : null;
  } catch { return null; }
}

// The phone's list → the shape parseNotifications() gives for adb.
function toRecords(items) {
  if (!Array.isArray(items)) return [];
  const str = (v) => (typeof v === 'string' && v ? v : null);
  return items.filter((n) => n && str(n.key) && str(n.pkg)).map((n) => ({
    key: n.key, pkg: n.pkg, when: Number(n.when) || 0,
    title: str(n.title), text: str(n.text), subText: str(n.subText),
    summary: !!n.summary, ongoing: !!n.ongoing,
  }));
}

// onStatus({ state, device }) on every change; onList() when a new list arrives;
// onTransfers(list) / onReceived(file) for file transfers (saved to downloadsDir).
function createBluetoothLink({ log, onStatus = () => {}, onList = () => {}, downloadsDir = null, onTransfers = () => {}, onReceived = () => {} }) {
  const script = fs.readFileSync(path.join(__dirname, 'bt-bridge.ps1'), 'utf8');
  let child = null;
  let wanted = false;
  let restartTimer = null;
  let status = { state: 'off', device: null };
  let model = null;
  let mac = null;
  let records = null;

  // Lines for the phone go through the bridge's input.
  function sendLine(line) {
    if (!child || status.state !== 'connected' || !child.stdin.writable) return false;
    child.stdin.write(`${line}\n`);
    return true;
  }
  const files = createFileTransfers({ sendLine, downloadsDir: downloadsDir || require('os').tmpdir(), onUpdate: onTransfers, onReceived, log });

  function setStatus(next) {
    status = { ...status, ...next };
    onStatus(status);
  }

  function handle(msg) {
    if (files.handle(msg)) return;
    if (msg.t === 'status') {
      if (msg.state !== 'connected') { records = null; files.disconnected(); }
      setStatus({ state: msg.state, device: msg.state === 'connected' ? (msg.device || model) : null });
      if (msg.error) log.warn('phone bluetooth', { error: String(msg.error).slice(0, 200) });
    } else if (msg.t === 'device') {
      mac = msg.mac || mac;
    } else if (msg.t === 'hello') {
      // Only a fallback: the name it was paired under ("realme P3 Ultra 5G") reads better than "RMX5030".
      model = typeof msg.model === 'string' ? msg.model : model;
      if (status.state === 'connected' && !status.device) setStatus({ device: model });
    } else if (msg.t === 'list') {
      records = toRecords(msg.items);
      onList();
    }
  }

  function launch() {
    if (child || !wanted) return;
    // Passed encoded rather than as a file: inside the packaged app the
    // script lives in app.asar, which PowerShell can't read.
    // The last phone that worked is tried first.
    const prefer = /^[0-9A-F:]{17}$/.test(mac || '') ? mac : '';
    const run = script.replace(/^param\([^\n]*\n/m, `$Prefer = '${prefer}'\n`);
    const encoded = Buffer.from(run, 'utf16le').toString('base64');
    child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true });
    setStatus({ state: 'searching', device: null });
    let buf = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const msg = parseLine(buf.slice(0, i));
        buf = buf.slice(i + 1);
        if (msg) handle(msg);
      }
      if (buf.length > 4 * 1024 * 1024) buf = '';
    });
    let err = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => { err = (err + d).slice(-500); });
    const proc = child;
    proc.on('error', (e) => log.warn('phone bluetooth', { error: e.message }));
    proc.stdin.on('error', () => { /* bridge exited; handled on exit */ });
    proc.on('exit', (code) => {
      if (child !== proc) return;
      child = null;
      records = null;
      files.disconnected();
      if (!wanted) return;
      log.warn('phone bluetooth bridge stopped', { code, error: err.trim().slice(0, 300) });
      setStatus({ state: 'searching', device: null });
      restartTimer = setTimeout(launch, RESTART_MS);
    });
  }

  return {
    start() {
      if (process.platform !== 'win32' || wanted) return;
      wanted = true;
      launch();
    },
    stop() {
      wanted = false;
      clearTimeout(restartTimer);
      records = null;
      files.disconnected();
      if (child) { const c = child; child = null; c.kill(); }
      setStatus({ state: 'off', device: null });
    },
    status: () => status,
    sendFiles: (paths) => {
      if (status.state !== 'connected') throw new Error("Your phone isn't connected over Bluetooth.");
      files.sendFiles(paths);
      return true;
    },
    cancelTransfer: (id) => files.cancel(id),
    transfers: () => files.list(),
    savedPath: (id) => files.savedPath(id),
    // { id, items } while a phone is connected and has sent its list, else null.
    current: () => (status.state === 'connected' && records ? { id: `bt:${mac || 'phone'}`, items: records } : null),
  };
}

module.exports = { createBluetoothLink, parseLine, toRecords };
