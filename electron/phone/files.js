// File transfer with the Buddy Link phone app over the Bluetooth link.
// Same messages as android/.../FileLink.java (one JSON line each):
//   fs {id,name,size,mime} start   fc {id,d} chunk (base64)   fe {id} end
//   fa {id,n} receiver has n bytes fd {id} saved              fx {id,reason} cancelled/failed
// The sender keeps at most WINDOW bytes unconfirmed, so notifications keep
// flowing during a transfer and a cancel stops it quickly.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CHUNK = 24 * 1024;
const WINDOW = 384 * 1024;
const ACK_EVERY = 128 * 1024;
const STALL_MS = 60_000;
const MAX_LIST = 20;

// A name from the phone → a safe file name for Windows.
function safeName(raw) {
  let s = String(raw || '').split(/[\\/]/).pop();
  s = s.replace(/[\x00-\x1f<>:"|?*]/g, '_').replace(/[. ]+$/, '').replace(/^\.+/, '').trim();
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(s)) s = `_${s}`;
  if (!s) s = 'file';
  return s.length > 150 ? s.slice(-150) : s;
}

// "photo.jpg" → "photo (1).jpg" while the name is taken.
function uniquePath(dir, name) {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let p = path.join(dir, name);
  for (let i = 1; fs.existsSync(p) && i < 1000; i++) p = path.join(dir, `${base} (${i})${ext}`);
  return p;
}

// sendLine(line) → false when the phone isn't connected. onUpdate(list) on any
// change; onReceived({ name, path, size }) when a file from the phone is saved.
function createFileTransfers({ sendLine, downloadsDir, onUpdate = () => {}, onReceived = () => {}, log }) {
  const items = new Map(); // id → transfer shown in the app
  const incoming = new Map(); // id → { fd, path, received, lastAck }
  const outgoing = new Map(); // id → { acked, saved, cancelled, wake }

  function view() {
    return [...items.values()].sort((a, b) => b.started - a.started).slice(0, MAX_LIST)
      .map(({ id, dir, name, size, done, state, error, path: p }) => ({ id, dir, name, size, done, state, error: error || null, saved: dir === 'in' && state === 'done' ? p : null }));
  }
  let timer = null;
  // Progress arrives many times a second; the window only needs a few updates.
  function changed(now = false) {
    if (now) { clearTimeout(timer); timer = null; onUpdate(view()); return; }
    if (!timer) timer = setTimeout(() => { timer = null; onUpdate(view()); }, 250);
  }
  function track(t) {
    items.set(t.id, t);
    // Keep the list short: forget the oldest finished ones.
    const finished = [...items.values()].filter((x) => x.state !== 'active').sort((a, b) => a.started - b.started);
    while (items.size > MAX_LIST && finished.length) items.delete(finished.shift().id);
    changed(true);
  }
  function finish(t, state, error) {
    t.state = state;
    if (error) t.error = error;
    changed(true);
  }

  // ---------------------------------------------------------------- phone → PC
  function startIncoming(m) {
    const id = String(m.id || '');
    if (!id || incoming.has(id)) return;
    const name = safeName(m.name);
    const t = { id, dir: 'in', name, size: Math.max(0, Number(m.size) || 0), done: 0, state: 'active', started: Date.now() };
    try {
      fs.mkdirSync(downloadsDir, { recursive: true });
      t.path = uniquePath(downloadsDir, name);
      t.name = path.basename(t.path);
      incoming.set(id, { fd: fs.openSync(t.path, 'wx'), path: t.path, received: 0, lastAck: 0 });
    } catch (err) {
      log.warn('phone file receive', { error: err.message });
      sendLine(JSON.stringify({ t: 'fx', id, reason: "The PC couldn't save the file" }));
      track(t);
      finish(t, 'failed', "Couldn't save the file");
      return;
    }
    track(t);
  }

  function chunk(m) {
    const inc = incoming.get(m.id);
    const t = items.get(m.id);
    if (!inc || !t) return;
    try {
      const buf = Buffer.from(String(m.d || ''), 'base64');
      fs.writeSync(inc.fd, buf);
      inc.received += buf.length;
      t.done = inc.received;
      if (inc.received - inc.lastAck >= ACK_EVERY) {
        inc.lastAck = inc.received;
        sendLine(JSON.stringify({ t: 'fa', id: m.id, n: inc.received }));
      }
      changed();
    } catch (err) {
      dropIncoming(m.id, "Couldn't save the file");
      sendLine(JSON.stringify({ t: 'fx', id: m.id, reason: "The PC couldn't save the file" }));
    }
  }

  function endIncoming(m) {
    const inc = incoming.get(m.id);
    const t = items.get(m.id);
    if (!inc || !t) return;
    incoming.delete(m.id);
    try { fs.closeSync(inc.fd); } catch { /* already closed */ }
    sendLine(JSON.stringify({ t: 'fa', id: m.id, n: inc.received }));
    sendLine(JSON.stringify({ t: 'fd', id: m.id }));
    t.done = inc.received;
    t.size = Math.max(t.size, inc.received);
    finish(t, 'done');
    onReceived({ name: t.name, path: t.path, size: inc.received });
  }

  function dropIncoming(id, why) {
    const inc = incoming.get(id);
    if (!inc) return;
    incoming.delete(id);
    try { fs.closeSync(inc.fd); } catch { /* already closed */ }
    try { fs.unlinkSync(inc.path); } catch { /* never written */ }
    const t = items.get(id);
    if (t) finish(t, 'failed', why);
  }

  // ---------------------------------------------------------------- PC → phone
  async function sendFile(file) {
    const st = await fs.promises.stat(file);
    if (!st.isFile()) throw new Error(`${path.basename(file)} isn't a file`);
    const id = crypto.randomBytes(6).toString('hex');
    const t = { id, dir: 'out', name: safeName(path.basename(file)), size: st.size, done: 0, state: 'active', started: Date.now() };
    const o = { acked: 0, saved: false, cancelled: null, wake: () => {} };
    outgoing.set(id, o);
    track(t);
    // Resolves when an ack/cancel arrives, or after a while to re-check.
    const wait = (ms) => new Promise((resolve) => { const to = setTimeout(resolve, ms); o.wake = () => { clearTimeout(to); resolve(); }; });
    let handle = null;
    try {
      if (!sendLine(JSON.stringify({ t: 'fs', id, name: t.name, size: st.size, mime: '' }))) throw new Error('Phone not connected');
      handle = await fs.promises.open(file, 'r');
      const buf = Buffer.alloc(CHUNK);
      let sent = 0;
      for (;;) {
        let stalled = Date.now();
        let lastAcked = o.acked;
        while (!o.cancelled && sent - o.acked > WINDOW) {
          await wait(1000);
          if (o.acked !== lastAcked) { lastAcked = o.acked; stalled = Date.now(); }
          if (Date.now() - stalled > STALL_MS) throw new Error('The phone stopped responding');
        }
        if (o.cancelled) throw new Error(o.cancelled);
        const { bytesRead } = await handle.read(buf, 0, CHUNK, null);
        if (bytesRead === 0) break;
        if (!sendLine(JSON.stringify({ t: 'fc', id, d: buf.subarray(0, bytesRead).toString('base64') }))) throw new Error('Phone disconnected');
        sent += bytesRead;
      }
      sendLine(JSON.stringify({ t: 'fe', id }));
      const deadline = Date.now() + STALL_MS;
      while (!o.saved && !o.cancelled && Date.now() < deadline) await wait(1000);
      if (o.cancelled) throw new Error(o.cancelled);
      if (!o.saved) throw new Error("The phone didn't confirm the file");
      t.done = t.size;
      finish(t, 'done');
    } catch (err) {
      if (!/cancelled/i.test(err.message)) sendLine(JSON.stringify({ t: 'fx', id, reason: err.message }));
      finish(t, /cancelled/i.test(err.message) ? 'cancelled' : 'failed', err.message);
    } finally {
      outgoing.delete(id);
      if (handle) await handle.close().catch(() => {});
    }
  }

  function ack(m) {
    const o = outgoing.get(m.id);
    const t = items.get(m.id);
    if (!o) return;
    o.acked = Math.max(o.acked, Number(m.n) || 0);
    if (t) { t.done = Math.min(t.size, o.acked); changed(); }
    o.wake();
  }

  return {
    // Returns true for file messages (they don't belong to anything else).
    handle(m) {
      switch (m.t) {
        case 'fs': startIncoming(m); return true;
        case 'fc': chunk(m); return true;
        case 'fe': endIncoming(m); return true;
        case 'fa': ack(m); return true;
        case 'fd': { const o = outgoing.get(m.id); if (o) { o.saved = true; o.wake(); } return true; }
        case 'fx': {
          const o = outgoing.get(m.id);
          if (o) { o.cancelled = m.reason || 'Cancelled on the phone'; o.wake(); }
          dropIncoming(m.id, m.reason || 'Cancelled on the phone');
          return true;
        }
        default: return false;
      }
    },
    // Many files go one after another, not all at once.
    sendFiles(files) {
      let chain = Promise.resolve();
      for (const f of files) chain = chain.then(() => sendFile(f)).catch((err) => log.warn('phone file send', { error: err.message }));
      return chain;
    },
    cancel(id) {
      const o = outgoing.get(id);
      if (o) { o.cancelled = 'Cancelled'; o.wake(); sendLine(JSON.stringify({ t: 'fx', id, reason: 'Cancelled on the PC' })); }
      if (incoming.has(id)) {
        sendLine(JSON.stringify({ t: 'fx', id, reason: 'Cancelled on the PC' }));
        dropIncoming(id, 'Cancelled');
        const t = items.get(id);
        if (t) finish(t, 'cancelled');
      }
      return true;
    },
    // The link dropped: nothing in flight can finish.
    disconnected() {
      for (const id of [...incoming.keys()]) dropIncoming(id, 'Phone disconnected');
      for (const o of outgoing.values()) { o.cancelled = 'Phone disconnected'; o.wake(); }
    },
    savedPath(id) {
      const t = items.get(id);
      return t && t.dir === 'in' && t.state === 'done' ? t.path : null;
    },
    list: view,
  };
}

module.exports = { createFileTransfers, safeName, uniquePath };
