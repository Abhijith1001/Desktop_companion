// Key/value settings in SQLite. Secrets (the cloud auth token) live under keys
// starting with "secret:" and are never returned by getAll().
const { tx } = require('../database/db');

const systemZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

const DEFAULTS = {
  character: 'dog',
  characterSize: 1,              // 0.75 – 1.5
  animation: 'full',             // full | reduced | off
  personality: true,             // character-specific dialogue vs plain reminders
  sound: true,
  volume: 0.6,
  speech: true,
  voice: '',                     // SpeechSynthesis voice name; '' = system default
  notificationMode: 'buddy+system', // buddy | buddy+system | system
  centerAnimation: true,         // run to screen centre for reminders
  intensity: 'normal',           // subtle | normal | strong
  alertTimeoutMinutes: 15,
  quietHours: { enabled: false, start: '22:00', end: '07:00' },
  defaultLeadMinutes: 0,
  defaultSnoozeMinutes: 10,
  missedPolicy: 'notify',        // notify | skip
  breakEveryMin: 60,             // wellness nudges; 0 = off
  timeZone: systemZone(),
  startWithWindows: false,
  startHidden: false,
  buddyHidden: false,
  pausedUntil: null,             // ISO; reminders held until then
  position: null,                // { x, displayId } last dropped position
  theme: 'system',               // system | light | dark
  // Text capture from other apps. Shortcuts are Electron accelerators.
  capture: { shortcut: 'Control+Shift+B', clipboardFallback: true, ocrEnabled: false, ocrShortcut: 'Control+Shift+O' },
  // Local dev server: serverUrl: 'http://localhost:4000'
  sync: { enabled: false, serverUrl: 'https://desktop-buddy-server.onrender.com', email: null, lastSyncAt: null, cursor: null, lastError: null },
};

function createSettings(db) {
  const get = (key) => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    if (!row) return structuredClone(DEFAULTS[key] ?? null);
    try { return JSON.parse(row.value); } catch { return structuredClone(DEFAULTS[key] ?? null); }
  };

  const setRaw = (key, value) => {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value));
  };

  const getAll = () => {
    const out = structuredClone(DEFAULTS);
    for (const row of db.prepare("SELECT key, value FROM settings WHERE key NOT LIKE 'secret:%' AND key NOT LIKE 'internal:%'").all()) {
      try {
        const v = JSON.parse(row.value);
        out[row.key] = DEFAULTS[row.key] && typeof DEFAULTS[row.key] === 'object' && !Array.isArray(DEFAULTS[row.key]) && v
          ? { ...DEFAULTS[row.key], ...v }
          : v;
      } catch { /* keep default */ }
    }
    return out;
  };

  const listeners = new Set();
  const update = (patch) => {
    tx(db, () => {
      for (const [k, v] of Object.entries(patch)) {
        const cur = get(k);
        const merged = cur && typeof cur === 'object' && !Array.isArray(cur) && v && typeof v === 'object' ? { ...cur, ...v } : v;
        setRaw(k, merged);
      }
    });
    const all = getAll();
    for (const fn of listeners) fn(all, patch);
    return all;
  };

  return {
    get: (key) => getAll()[key],
    getAll,
    update,
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    getSecret: (key) => get(`secret:${key}`),
    setSecret: (key, value) => (value == null
      ? db.prepare('DELETE FROM settings WHERE key = ?').run(`secret:${key}`)
      : setRaw(`secret:${key}`, value)),
    getInternal: (key) => get(`internal:${key}`),
    setInternal: (key, value) => setRaw(`internal:${key}`, value),
  };
}

module.exports = { createSettings, DEFAULTS };
