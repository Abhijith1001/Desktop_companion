// Phone mirror: talks to an Android phone through the bundled adb (over Wi-Fi
// via wireless debugging, or USB), runs the scrcpy server on it and relays
// the H.264 stream to the renderer, which decodes and draws it. Input from
// the renderer goes back as scrcpy control messages.
// Everything stays on the local network; nothing is sent to our servers.
const fs = require('fs');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { execFile, execFileSync, spawn } = require('child_process');
const p = require('./protocol');

const REMOTE_SERVER = '/data/local/tmp/scrcpy-server.jar';
const ADB_TIMEOUT_MS = 20_000;
const CONNECT_ATTEMPTS = 100;
const CONNECT_RETRY_MS = 100;

const QUALITY = {
  low: { maxSize: 1024, bitRate: 4_000_000, maxFps: 30 },
  balanced: { maxSize: 1600, bitRate: 8_000_000, maxFps: 60 },
  high: { maxSize: 0, bitRate: 16_000_000, maxFps: 60 },
};

// Phone-shaped virtual display for "separate" mode: width x height / dpi.
const VIRTUAL_DISPLAY = '1080x2340/420';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Packaged: resources/phone (extraResources). Dev: vendor/phone.
function toolsDir({ isPackaged, resourcesPath }) {
  return isPackaged ? path.join(resourcesPath, 'phone') : path.join(__dirname, '..', '..', 'vendor', 'phone');
}

// "adb devices -l" → [{ serial, state, model, wifi }]
function parseDevices(out) {
  return String(out).split(/\r?\n/).slice(1).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [serial, state, ...rest] = line.split(/\s+/);
    const props = Object.fromEntries(rest.map((kv) => kv.split(':')).filter((kv) => kv.length === 2));
    return {
      serial, state,
      model: (props.model || props.device || serial).replace(/_/g, ' '),
      wifi: /:\d+$/.test(serial) || serial.includes('._adb-tls-connect.'),
    };
  }).filter((d) => d.serial && d.state);
}

// "adb mdns services" → phones advertising wireless debugging on this network.
function parseMdns(out) {
  const found = [];
  for (const line of String(out).split(/\r?\n/)) {
    const m = line.trim().match(/^(\S+)\s+(_adb-tls-(?:connect|pairing)\._tcp)\.?\s+([\d.]+):(\d+)$/);
    if (m) found.push({ name: m[1], kind: m[2].includes('pairing') ? 'pairing' : 'connect', host: m[3], port: Number(m[4]) });
  }
  return found;
}

function createPhoneMirror({ log, isPackaged, resourcesPath, send = () => {}, readClipboard = () => '', writeClipboard = () => {} }) {
  const dir = toolsDir({ isPackaged, resourcesPath });
  const adbPath = path.join(dir, process.platform === 'win32' ? 'adb.exe' : 'adb');
  const serverPath = path.join(dir, 'scrcpy-server');
  let session = null;
  let status = { state: 'idle' };
  let lastClipboard = null;
  // adb only starts once the user opens the Phone page, not for everyone at launch.
  let used = false;
  let viewing = false;

  function setStatus(next) {
    status = next;
    send('phone:status', status);
  }

  function available() {
    return fs.existsSync(adbPath) && fs.existsSync(serverPath);
  }

  function adb(args, { timeout = ADB_TIMEOUT_MS } = {}) {
    if (!available()) return Promise.reject(new Error('Phone tools are missing from this install.'));
    return new Promise((resolve, reject) => {
      execFile(adbPath, args, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
        const out = `${stdout || ''}${stderr || ''}`.trim();
        if (err) {
          const e = new Error(out.split(/\r?\n/).pop() || err.message);
          e.output = out;
          return reject(e);
        }
        resolve(out);
      });
    });
  }

  async function devices() {
    return parseDevices(await adb(['devices', '-l']));
  }

  async function discover() {
    try { return parseMdns(await adb(['mdns', 'services'], { timeout: 8000 })); } catch { return []; }
  }

  // adb's own errors for an unreachable phone are cryptic ("protocol fault
  // (couldn't read status message)"), so check the network path first.
  function reachable(host, port, timeout = 3000) {
    return new Promise((resolve) => {
      const s = net.connect({ host, port });
      const done = (ok) => { s.destroy(); resolve(ok); };
      s.setTimeout(timeout, () => done(false));
      s.once('connect', () => done(true));
      s.once('error', () => done(false));
    });
  }

  async function ensureReachable(host, port) {
    if (await reachable(host, port)) return;
    throw new Error(`Can't reach the phone at ${host}:${port}. Check both are on the same Wi-Fi, the address and port are current, `
      + 'and that the network lets devices see each other (office and guest Wi-Fi often block this; a phone hotspot works).');
  }

  async function pair(host, port, code) {
    await ensureReachable(host, port);
    const out = await adb(['pair', `${host}:${port}`, code], { timeout: 30_000 });
    if (!/successfully paired/i.test(out)) throw new Error(out.split(/\r?\n/).pop() || 'Pairing failed.');
    return { ok: true };
  }

  // QR pairing, as in Android Studio: the phone scans
  // "WIFI:T:ADB;S:<name>;P:<password>;;", then advertises a pairing service
  // with that name over mDNS. We watch for it, pair, then connect.
  let qr = null;
  const randomText = (n) => {
    const abc = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from(crypto.randomBytes(n), (b) => abc[b % abc.length]).join('');
  };

  function qrStart() {
    qrCancel();
    const job = { name: `buddy-${randomText(8)}`, password: randomText(10), cancelled: false };
    qr = job;
    const emit = (state, extra = {}) => { if (qr === job) send('phone:qr', { state, ...extra }); };
    (async () => {
      const deadline = Date.now() + 120_000;
      try {
        let target = null;
        while (!job.cancelled && Date.now() < deadline && !target) {
          target = (await discover()).find((d) => d.kind === 'pairing' && d.name === job.name);
          if (!target) await sleep(1000);
        }
        if (job.cancelled) return;
        if (!target) throw new Error('No phone scanned the code in time. Show a new code and try again.');
        emit('pairing');
        await pair(target.host, target.port, job.password);
        // After pairing, the phone advertises its connect port on the same host.
        emit('connecting');
        let conn = null;
        for (let i = 0; i < 15 && !job.cancelled && !conn; i++) {
          conn = (await discover()).find((d) => d.kind === 'connect' && d.host === target.host);
          if (!conn) await sleep(1000);
        }
        if (job.cancelled) return;
        if (conn) await connect(conn.host, conn.port).catch(() => {});
        emit('done', { host: target.host, serial: conn ? `${conn.host}:${conn.port}` : null });
      } catch (err) {
        emit('error', { message: err.message });
      } finally {
        if (qr === job) qr = null;
      }
    })();
    return { payload: `WIFI:T:ADB;S:${job.name};P:${job.password};;` };
  }

  function qrCancel() {
    if (qr) qr.cancelled = true;
    qr = null;
    return true;
  }

  async function connect(host, port) {
    await ensureReachable(host, port);
    const out = await adb(['connect', `${host}:${port}`], { timeout: 15_000 });
    if (!/connected to/i.test(out) || /failed|cannot|unable/i.test(out)) throw new Error(out || 'Could not connect.');
    return { ok: true, serial: `${host}:${port}` };
  }

  async function disconnect(serial) {
    if (session?.serial === serial) await stop();
    await adb(['disconnect', serial]).catch(() => {});
    return true;
  }

  // Connects to the forwarded port until the server answers. adb accepts the
  // TCP connection even before the server listens, then drops it, so a
  // connection only counts once the expected first byte(s) arrive.
  async function openSocket(port, { expectDummy }) {
    for (let i = 0; i < CONNECT_ATTEMPTS; i++) {
      if (!session) throw new Error('Stopped');
      try {
        const sock = await new Promise((resolve, reject) => {
          const s = net.connect({ host: '127.0.0.1', port }, () => {
            if (!expectDummy) return resolve(s);
            s.once('data', (chunk) => {
              s.removeAllListeners('close');
              s.pause();
              if (chunk.length > 1) s.unshift(chunk.subarray(1));
              resolve(s);
            });
          });
          s.once('error', reject);
          s.once('close', () => reject(new Error('closed')));
        });
        sock.removeAllListeners('error');
        sock.setNoDelay(true);
        return sock;
      } catch {
        await sleep(CONNECT_RETRY_MS);
      }
    }
    throw new Error('The phone did not start mirroring. Is the screen unlocked?');
  }

  // mode "separate" runs apps on a virtual display of their own, so the
  // phone's real screen stays free (Android 10+; scrcpy --new-display).
  async function start(serial, { quality = 'balanced', screenOff = false, mode = 'mirror', startApp = null } = {}) {
    const separate = mode === 'separate';
    if (separate) screenOff = false;
    if (session) await stop();
    const q = QUALITY[quality] || QUALITY.balanced;
    const scid = (crypto.randomBytes(4).readUInt32BE(0) & 0x7fffffff).toString(16).padStart(8, '0');
    const s = { serial, scid, port: 0, proc: null, video: null, control: null, screenOff, stopped: false };
    session = s;
    setStatus({ state: 'starting', serial, message: 'Starting…' });

    try {
      await adb(['-s', serial, 'push', serverPath, REMOTE_SERVER], { timeout: 60_000 });
      const fwd = await adb(['-s', serial, 'forward', 'tcp:0', `localabstract:scrcpy_${scid}`]);
      s.port = Number(fwd.trim().split(/\s+/).pop());
      if (!Number.isInteger(s.port) || s.port <= 0) throw new Error('Could not open a tunnel to the phone.');

      const args = [
        '-s', serial, 'shell', `CLASSPATH=${REMOTE_SERVER}`, 'app_process', '/', 'com.genymobile.scrcpy.Server', p.SCRCPY_VERSION,
        `scid=${scid}`, 'log_level=info', 'tunnel_forward=true', 'audio=false', 'control=true', 'video_codec=h264',
        `max_size=${q.maxSize}`, `video_bit_rate=${q.bitRate}`, `max_fps=${q.maxFps}`,
        'stay_awake=true', 'clipboard_autosync=true', 'power_off_on_close=false', 'cleanup=true',
        // The phone's on-screen keyboard is hidden: you type on the PC keyboard.
        ...(separate ? [`new_display=${VIRTUAL_DISPLAY}`, 'display_ime_policy=hide'] : []),
      ];
      s.proc = spawn(adbPath, args, { windowsHide: true });
      s.proc.stdout.on('data', (d) => {
        const out = String(d);
        log.info('phone server', { out: out.trim().slice(0, 500) });
        // "New display: 1080x2340/420 (id=12)" → open the chosen app there.
        const m = out.match(/New display: \S+ \(id=(\d+)\)/);
        if (m && startApp) launchApp(serial, Number(m[1]), startApp).catch((err) => log.warn('phone start app', { error: err.message }));
      });
      s.proc.stderr.on('data', (d) => log.warn('phone server', { err: String(d).trim().slice(0, 500) }));
      s.proc.on('exit', (code) => { if (session === s && !s.stopped) end(s, code ? 'The phone ended the mirroring session.' : null); });

      s.video = await openSocket(s.port, { expectDummy: true });
      s.control = await openSocket(s.port, { expectDummy: false });
      if (session !== s) throw new Error('Stopped');

      const onVideo = p.createVideoParser((evt) => {
        if (evt.type === 'device') s.deviceName = evt.name;
        else if (evt.type === 'codec') setStatus({ state: 'live', serial, device: s.deviceName || serial, width: evt.width, height: evt.height });
        // Mirroring runs on with the window hidden or on another page; frames
        // only cross IPC while the Phone screen is actually showing.
        else if (viewing) send('phone:frame', { data: evt.data, key: evt.key, pts: evt.pts });
      });
      s.video.on('data', (chunk) => {
        try { onVideo(chunk); } catch (err) { log.warn('phone stream', { error: err.message }); end(s, 'The video stream broke off.'); }
      });
      s.video.on('close', () => { if (session === s && !s.stopped) end(s, 'The connection to the phone was lost.'); });
      s.video.on('error', () => {});
      s.video.resume();

      const onDevice = p.createDeviceMessageParser((msg) => {
        if (msg.type === 'clipboard' && msg.text !== lastClipboard) { lastClipboard = msg.text; writeClipboard(msg.text); }
      });
      s.control.on('data', onDevice);
      s.control.on('error', () => {});

      if (screenOff) write(p.setDisplayPower(false));
      log.info('phone mirroring', { serial: serial.replace(/[\d.]+:/, '…:'), quality });
      return status;
    } catch (err) {
      const message = err.message === 'Stopped' ? null : err.message;
      await end(s, message);
      if (message) throw new Error(message);
      return status;
    }
  }

  // Starts an app's launcher activity on a given display. The package name
  // is validated by the IPC layer before it gets here.
  async function launchApp(serial, displayId, pkg) {
    const resolved = await adb(['-s', serial, 'shell', 'cmd', 'package', 'resolve-activity', '--brief', '-c', 'android.intent.category.LAUNCHER', pkg]);
    const component = resolved.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.includes('/')).pop();
    if (!component) throw new Error(`${pkg} is not installed`);
    await adb(['-s', serial, 'shell', 'am', 'start', '--display', String(displayId), '-n', component]);
  }

  async function end(s, message) {
    if (s.stopped) return;
    s.stopped = true;
    if (session === s) session = null;
    try { if (s.screenOff && s.control && !s.control.destroyed) s.control.write(p.setDisplayPower(true)); } catch { /* closing */ }
    for (const sock of [s.video, s.control]) { try { sock?.destroy(); } catch { /* closed */ } }
    try { s.proc?.kill(); } catch { /* exited */ }
    if (s.port) await adb(['-s', s.serial, 'forward', '--remove', `tcp:${s.port}`]).catch(() => {});
    if (!session) setStatus(message ? { state: 'error', serial: s.serial, message } : { state: 'idle' });
  }

  async function stop() {
    if (session) await end(session, null);
    return true;
  }

  function write(buf) {
    const sock = session?.control;
    if (!sock || sock.destroyed) return false;
    sock.write(buf);
    return true;
  }

  // One validated input event from the renderer.
  function input(evt) {
    switch (evt.kind) {
      case 'touch': return write(p.touch({ ...evt, action: p.ACTION[evt.action] }));
      case 'scroll': return write(p.scroll(evt));
      case 'text': return write(p.text(evt.text));
      case 'key': return write(p.keycode({ action: p.ACTION[evt.action], keycode: evt.keycode, metastate: evt.metastate || 0 }));
      case 'button': return button(evt.button);
      // Asks the phone for a fresh key frame, e.g. after the decoder fell behind.
      case 'reset': return write(p.simple(p.MSG.RESET_VIDEO));
      case 'paste': {
        const clip = readClipboard();
        return clip ? write(p.setClipboard(clip, { paste: true })) : false;
      }
      case 'screen': {
        if (session) session.screenOff = !evt.on;
        return write(p.setDisplayPower(evt.on));
      }
      default: return false;
    }
  }

  function button(name) {
    switch (name) {
      case 'back': return write(Buffer.concat([p.backOrScreenOn(p.ACTION.DOWN), p.backOrScreenOn(p.ACTION.UP)]));
      case 'home': return write(p.keyPress(p.KEYCODE.HOME));
      case 'recents': return write(p.keyPress(p.KEYCODE.APP_SWITCH));
      case 'power': return write(p.keyPress(p.KEYCODE.POWER));
      case 'volumeUp': return write(p.keyPress(p.KEYCODE.VOLUME_UP));
      case 'volumeDown': return write(p.keyPress(p.KEYCODE.VOLUME_DOWN));
      case 'notifications': return write(p.simple(p.MSG.EXPAND_NOTIFICATIONS));
      case 'rotate': return write(p.simple(p.MSG.ROTATE_DEVICE));
      default: return false;
    }
  }

  // On quit (synchronous, as will-quit can't wait): end the session and stop
  // our adb server so the installer can replace adb.exe on update.
  function shutdown() {
    qrCancel();
    const s = session;
    if (s) {
      s.stopped = true;
      session = null;
      try { if (s.screenOff) s.control?.write(p.setDisplayPower(true)); } catch { /* closing */ }
      for (const sock of [s.video, s.control]) { try { sock?.destroy(); } catch { /* closed */ } }
      try { s.proc?.kill(); } catch { /* exited */ }
    }
    if (available()) {
      try { execFileSync(adbPath, ['kill-server'], { timeout: 3000, windowsHide: true, stdio: 'ignore' }); } catch { /* not running */ }
    }
  }

  return {
    // The phone to watch for notifications: the mirrored one, else the first ready one.
    readySerial: async () => {
      if (!available() || !used) return null;
      if (session) return session.serial;
      return (await devices()).find((d) => d.state === 'device')?.serial ?? null;
    },
    adb,
    available, status: () => ({ ...status, available: available() }),
    devices: () => { used = true; return devices(); },
    markUsed: () => { used = true; },
    // The Phone screen became visible (true) or went away (false). Coming back
    // needs a fresh key frame, as frames were skipped meanwhile.
    setViewing: (on) => {
      viewing = !!on;
      if (on) write(p.simple(p.MSG.RESET_VIDEO));
      return true;
    }, discover, pair, connect, disconnect, qrStart, qrCancel,
    start, stop, input, shutdown,
  };
}

module.exports = { createPhoneMirror, parseDevices, parseMdns, QUALITY };
