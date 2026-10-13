// Cross-application text capture on Windows. Every capture is a single,
// user-initiated action (shortcut, tray or button); nothing here runs in the
// background or watches the screen.
//
// Order of preference for "capture selection":
//   1. UI Automation TextPattern on the focused control (no clipboard use)
//   2. Synthetic Ctrl+C, with the user's clipboard saved first and restored after
// OCR of the foreground window is a separate, opt-in action.
const path = require('path');
const { execFile } = require('child_process');
const { sensitiveWarnings } = require('./sensitive');

const MAX_CHARS = 100_000;
const HELPER_TIMEOUT_MS = 20_000;

// Packaged builds unpack this folder (see "asarUnpack" in package.json) because
// PowerShell cannot read files inside app.asar.
const helperPath = () => path.join(__dirname, 'capture.ps1').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');

const REASONS = {
  'no-selection': 'No selected text was found. Select some text first, then press the shortcut again.',
  'password-field': 'That is a password field, so nothing was captured.',
  self: 'Desktop Buddy itself is the active window. Switch to the app with your text, select it, then press the shortcut.',
  'no-window': 'No active window was found.',
  'ocr-unavailable': 'Windows OCR is not available. Install an OCR language in Windows Settings > Time & language > Language.',
  'no-text': 'No readable text was found in that window.',
  'window-too-small': 'The active window is too small to read.',
  'clipboard-unsafe': 'Your clipboard holds something I cannot put back exactly (for example copied files), so I did not use it. Copy the text yourself or drag it into the chat.',
  'clipboard-disabled': 'This app does not expose its selection, and the clipboard fallback is turned off in Settings. Drag the text into the chat instead.',
  timeout: 'Capturing took too long and was cancelled.',
  unsupported: 'Capturing text from other apps is only supported on Windows.',
  busy: 'A capture is already in progress.',
  error: 'Something went wrong while capturing. See the log for details.',
};

function cleanUrl(u) {
  if (!u) return null;
  try { return ['http:', 'https:'].includes(new URL(u).protocol) && u.length <= 2000 ? u : null; } catch { return null; }
}

function normalizeText(text) {
  let t = String(text || '').replace(/\r\n?/g, '\n').replace(/\u0000/g, '').replace(/[ \t]+\n/g, '\n').trim();
  const truncated = t.length > MAX_CHARS;
  if (truncated) t = t.slice(0, MAX_CHARS);
  return { text: t, truncated };
}

// Browsers append " - Google Chrome" etc. to window titles.
function cleanTitle(title, app) {
  let t = String(title || '').trim();
  if (app) t = t.replace(new RegExp(`\\s+[-–—]\\s+${app.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), '');
  return t.replace(/\s+[-–—]\s+(Google Chrome|Microsoft​? Edge|Mozilla Firefox|Brave|Opera|Vivaldi)$/i, '').slice(0, 500) || null;
}

// clipboard: Electron's async clipboard (read/write of ClipboardItem[]), which
// exposes every OS format, including raw ones, so a snapshot restores exactly.
function createCapture({ clipboard, ClipboardItem, log, ownPid = process.pid, platform = process.platform, run = runHelper, getOptions = () => ({}) }) {
  let busy = false;

  async function snapshot() {
    const items = [];
    for (const item of await clipboard.read()) {
      const rec = {};
      for (const type of item.types) rec[type] = await item.getType(type);
      if (Object.keys(rec).length) items.push(rec);
    }
    // Copied files (Explorer) can't be recreated reliably from their formats.
    const safe = !items.some((rec) => 'text/uri-list' in rec);
    return { items, safe };
  }
  async function restore(snap) {
    try {
      if (!snap.items.length) await clipboard.clear();
      else await clipboard.write(snap.items.map((rec) => new ClipboardItem(rec)));
    } catch (err) {
      log.warn('clipboard restore failed', { error: err.message });
    }
  }

  const fail = (reason, extra = {}) => ({ ok: false, reason, message: REASONS[reason] || REASONS.error, ...extra });

  function finish(raw, method, text, urlFromClipboard) {
    const { text: clean, truncated } = normalizeText(text);
    if (!clean) return fail(method === 'ocr' ? 'no-text' : 'no-selection');
    return {
      ok: true,
      text: clean,
      truncated,
      method,
      sourceApp: raw.app ? String(raw.app).slice(0, 200) : null,
      sourceTitle: cleanTitle(raw.title, raw.app),
      sourceUrl: cleanUrl(urlFromClipboard) || cleanUrl(raw.url),
      warnings: sensitiveWarnings(clean),
      capturedAt: new Date().toISOString(),
    };
  }

  async function guarded(fn) {
    if (platform !== 'win32') return fail('unsupported');
    if (busy) return fail('busy');
    busy = true;
    try { return await fn(); } catch (err) {
      log.warn('capture failed', { error: err.message });
      return fail(err.code === 'TIMEOUT' ? 'timeout' : 'error');
    } finally { busy = false; }
  }

  // Selected text in the foreground app.
  const selection = () => guarded(async () => {
    const { clipboardFallback = true } = getOptions();
    const snap = clipboardFallback ? await snapshot() : { safe: false };
    const allowCopy = clipboardFallback && snap.safe;
    const raw = await run('selection', { allowCopy });
    if (raw.method === 'clipboard' && raw.copied) {
      const text = await clipboard.readText();
      await restore(snap);
      if (raw.pid === ownPid) return fail('self');
      log.info('captured selection', { method: 'clipboard', app: raw.process });
      return finish(raw, 'clipboard', text, raw.clipUrl);
    }
    if (raw.pid === ownPid) return fail('self');
    if (raw.ok && raw.method === 'uia') {
      log.info('captured selection', { method: 'uia', app: raw.process });
      return finish(raw, 'uia', raw.text);
    }
    if (raw.reason === 'error') log.warn('capture helper error', { error: raw.error });
    if (raw.reason === 'no-selection' && !allowCopy) return fail(clipboardFallback ? 'clipboard-unsafe' : 'clipboard-disabled');
    return fail(raw.reason || 'error');
  });

  // One-time OCR of the foreground window. The screenshot stays in memory in
  // the helper process and is discarded when it exits.
  const ocr = () => guarded(async () => {
    const raw = await run('ocr', {});
    if (raw.pid === ownPid) return fail('self');
    if (!raw.ok) {
      if (raw.reason === 'error') log.warn('ocr helper error', { error: raw.error });
      return fail(raw.reason || 'error');
    }
    log.info('captured with ocr', { app: raw.process });
    return finish(raw, 'ocr', raw.text);
  });

  // Best-effort source of a drag-and-drop: the window that was active when the
  // text was dropped. Returns null when unknown or when it is Desktop Buddy.
  async function foreground() {
    if (platform !== 'win32') return null;
    try {
      const raw = await run('info', {});
      if (!raw.ok || raw.pid === ownPid) return null;
      return { sourceApp: raw.app || null, sourceTitle: cleanTitle(raw.title, raw.app), sourceUrl: cleanUrl(raw.url) };
    } catch { return null; }
  }

  return { selection, ocr, foreground, get busy() { return busy; } };
}

function runHelper(mode, { allowCopy = false } = {}) {
  // -STA: the helper reads the clipboard's HTML format after copying.
  const args = ['-NoProfile', '-STA', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helperPath(), '-Mode', mode, '-MaxChars', String(MAX_CHARS)];
  if (allowCopy) args.push('-AllowCopy');
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', args, { windowsHide: true, timeout: HELPER_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' }, (err, stdout) => {
      if (err && err.killed) { const e = new Error('capture timed out'); e.code = 'TIMEOUT'; return reject(e); }
      try {
        resolve(JSON.parse(String(stdout).replace(/^﻿/, '').trim()));
      } catch {
        reject(new Error(err ? err.message : 'capture helper returned no result'));
      }
    });
  });
}

module.exports = { createCapture, normalizeText, cleanTitle, REASONS, helperPath };
