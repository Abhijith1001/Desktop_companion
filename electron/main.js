// Desktop Buddy — main process. Owns the database, the reminder engine and
// sync; windows are views that can be hidden or crash without stopping them.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { app, dialog, ipcMain, shell, powerMonitor, globalShortcut, safeStorage, clipboard, ClipboardItem } = require('electron');

const log = require('./logger');
const { open: openDb, schemaVersion } = require('./database/db');
const { createSettings } = require('./services/settings');
const { createTaskService } = require('./services/tasks');
const { createBookmarkService } = require('./services/bookmarks');
const { createNoteService } = require('./services/notes');
const { createAi } = require('./services/ai');
const { createCapture, normalizeText } = require('./capture');
const { sensitiveWarnings } = require('./capture/sensitive');
const { createEngine } = require('./scheduler/engine');
const { createSync } = require('./sync/client');
const { createPresenter } = require('./notifications/presenter');
const { createPetWindow } = require('./windows/pet');
const { createManager } = require('./windows/manager');
const { createTray } = require('./tray/tray');
const { createHandlers } = require('./ipc/handlers');
const { importLegacy } = require('./legacy');
const { makeIcon } = require('./icon');
const dialogue = require('./dialogue');

const APP_ID = 'com.devwerks.desktopbuddy';
app.setAppUserModelId(APP_ID); // required for Windows notifications
app.isQuitting = false;

// Separate data folder for automated tests (also gives them their own
// single-instance lock, so they never touch a running copy).
if (process.env.BUDDY_USER_DATA) app.setPath('userData', process.env.BUDDY_USER_DATA);

if (!app.requestSingleInstanceLock()) {
  console.log('Desktop Buddy is already running (look for the paw icon in the tray). Opened its task window instead.');
  app.exit(0);
} else {
  start();
}

function start() {
  // Errors are logged, never turned into an automatic restart loop.
  process.on('uncaughtException', (err) => log.error('uncaught exception', { error: err.message, stack: err.stack }));
  process.on('unhandledRejection', (err) => log.error('unhandled rejection', { error: String(err && err.message || err) }));

  let db; let settings; let tasks; let engine; let sync; let presenter; let pet; let manager; let tray;
  let bookmarks; let capture; let ai; let notes;

  const characters = () => {
    const ctx = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'pet/characters.js'), 'utf8'), ctx);
    return Object.entries(ctx.window.CHARACTERS).map(([id, c]) => ({ id, name: c.name }));
  };

  // Cloud token: encrypted with the OS credential store, never stored in plain text.
  const getToken = () => {
    const enc = settings.getSecret('authToken');
    if (!enc || !safeStorage.isEncryptionAvailable()) return null;
    try { return safeStorage.decryptString(Buffer.from(enc, 'base64')); } catch { return null; }
  };
  const setToken = (token) => {
    if (token == null) return settings.setSecret('authToken', null);
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is not available on this system');
    return settings.setSecret('authToken', safeStorage.encryptString(token).toString('base64'));
  };

  // Secrets encrypted with the OS credential store (DPAPI on Windows).
  const readSecret = (name) => {
    const enc = settings.getSecret(name);
    if (!enc || !safeStorage.isEncryptionAvailable()) return null;
    try { return safeStorage.decryptString(Buffer.from(enc, 'base64')); } catch { return null; }
  };
  const writeSecret = (name, value) => {
    if (value == null) return settings.setSecret(name, null);
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is not available on this system');
    return settings.setSecret(name, safeStorage.encryptString(value).toString('base64'));
  };

  const openTasks = (route) => manager.open(route);

  // ---- Text capture. The latest result waits here until the chat picks it up,
  // so it is not lost if the window is still loading.
  let pendingCapture = null;
  const shortcutState = { capture: null, ocr: null };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const say = (text, ms = 2500) => { try { if (pet.isVisible() && !presenter.current) pet.speak(text, ms); } catch { /* pet not ready */ } };

  async function runCapture(kind, delaySeconds = 0) {
    if (kind === 'ocr' && !settings.get('capture').ocrEnabled) {
      return { ok: false, reason: 'ocr-off', message: 'Screen reading is off. Turn it on in Settings > Text capture first.' };
    }
    if (delaySeconds) {
      say(`Switch to the window now - capturing in ${delaySeconds} s`, delaySeconds * 1000);
      await sleep(delaySeconds * 1000);
    }
    // Visible indicator: screen reading always announces itself.
    if (kind === 'ocr') say('📷 Reading the active window once (OCR)…', 4000);
    const result = kind === 'ocr' ? await capture.ocr() : await capture.selection();
    if (result.ok) say(kind === 'ocr' ? 'Done reading - nothing was saved yet.' : 'Got it! Review it in the chat.', 2500);
    pendingCapture = result;
    manager.open('/chat');
    manager.send('capture:new');
    return result;
  }

  // Text dropped on the buddy is saved straight away as a bookmark.
  async function saveDroppedText(raw, uri) {
    const { text, truncated } = normalizeText(raw);
    if (!text) { say('I can only keep text - try selecting some words first.', 3000); return { ok: false }; }
    const source = await capture.foreground().catch(() => null);
    const link = /^https?:\/\//i.test(uri) ? uri : source?.sourceUrl ?? null;
    const line = text.split('\n').find((l) => l.trim()).trim();
    try {
      const r = bookmarks.create({
        title: line.length > 80 ? `${line.slice(0, 77)}…` : line,
        text, sourceApp: source?.sourceApp ?? null, sourceTitle: source?.sourceTitle ?? null,
        sourceUrl: link && link.length <= 2000 ? link : null, captureMethod: 'drop', notes: '', tags: [], isFavorite: false,
      });
      if (r.duplicate) { say('I already have that one saved!', 2500); return { ok: true, duplicate: true }; }
      say(truncated ? 'Saved! It was long, so I kept the first part.' : 'Saved to your bookmarks!', 2500);
      return { ok: true };
    } catch (err) {
      log.warn('drop save failed', { error: err.message });
      say("Sorry, I couldn't save that.", 3000);
      return { ok: false };
    }
  }

  function registerShortcuts() {
    for (const k of ['capture', 'ocr']) {
      if (shortcutState[k]?.accelerator) { try { globalShortcut.unregister(shortcutState[k].accelerator); } catch { /* not registered */ } }
      shortcutState[k] = null;
    }
    const c = settings.get('capture');
    const reg = (key, accelerator, fn) => {
      let ok = false;
      try { ok = globalShortcut.register(accelerator, fn); } catch (err) { log.warn('shortcut rejected', { accelerator, error: err.message }); }
      // register() returns false when another app already owns the combination.
      shortcutState[key] = { accelerator, registered: ok };
      if (!ok) log.warn('shortcut unavailable', { accelerator });
    };
    reg('capture', c.shortcut, () => runCapture('selection'));
    if (c.ocrEnabled && c.ocrShortcut !== c.shortcut) reg('ocr', c.ocrShortcut, () => runCapture('ocr'));
    manager && manager.send('capture:status', captureStatus());
  }
  const captureStatus = () => ({ platformSupported: process.platform === 'win32', shortcuts: { ...shortcutState }, busy: capture.busy });

  async function confirmClearBookmarks() {
    const { response } = await dialog.showMessageBox(manager.window, {
      type: 'warning', buttons: ['Delete all bookmarks', 'Cancel'], defaultId: 1, cancelId: 1,
      title: 'Delete all bookmarks', message: 'Permanently delete all saved bookmarks?',
      detail: 'This removes every bookmark, note and tag from this computer. It cannot be undone.',
    });
    return response === 0;
  }

  function hint() {
    const s = settings.getAll();
    if (s.pausedUntil && Date.parse(s.pausedUntil) > Date.now()) {
      return { label: 'Reminders paused', title: `Until ${new Date(s.pausedUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` };
    }
    const next = tasks.list().find((t) => t.status === 'PENDING' && t.nextOccurrenceAt);
    if (!next) return { label: 'Hi!', title: 'Click me to add a task' };
    const d = new Date(next.nextOccurrenceAt);
    const sameDay = d.toDateString() === new Date().toDateString();
    const when = (sameDay ? '' : `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} `)
      + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return { label: `Up next · ${when}`, title: next.title };
  }

  function pause(minutes) {
    settings.update({ pausedUntil: minutes == null ? null : new Date(Date.now() + minutes * 60_000).toISOString() });
    engine.wake();
  }

  async function exit() {
    const { response } = await dialog.showMessageBox({
      type: 'question', buttons: ['Exit', 'Cancel'], defaultId: 1, cancelId: 1,
      title: 'Exit Desktop Buddy?', message: 'Exit Desktop Buddy?',
      detail: 'Reminders will not be delivered while Desktop Buddy is closed. Any you miss will be shown the next time it starts.\n\nTip: turn on "Start with Windows" in Settings so it is always running.',
    });
    if (response === 0) quit();
  }

  function quit() {
    app.isQuitting = true;
    app.quit();
  }

  async function exportData() {
    const { canceled, filePath } = await dialog.showSaveDialog(manager.window, {
      title: 'Export my data', defaultPath: `desktop-buddy-export-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || !filePath) return null;
    const status = sync.status();
    const cloud = status.signedIn ? await sync.exportCloud().catch((e) => ({ error: e.message })) : null;
    const payload = {
      exportedAt: new Date().toISOString(), app: app.getVersion(),
      local: { tasks: tasks.list().map((t) => tasks.get(t.id)), bookmarks: bookmarks.exportAll(), notes: notes.exportAll(), settings: settings.getAll() },
      cloud,
    };
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
    return filePath;
  }

  async function confirmDeleteAccount() {
    const { response } = await dialog.showMessageBox(manager.window, {
      type: 'warning', buttons: ['Delete my cloud account', 'Cancel'], defaultId: 1, cancelId: 1,
      title: 'Delete cloud account', message: 'Delete your cloud account and all synced data?',
      detail: 'Tasks on this computer are kept. This cannot be undone.',
    });
    return response === 0;
  }

  function previewBuddy() {
    if (!pet.isVisible()) pet.show();
    const s = settings.getAll();
    pet.speak(dialogue.line(s.character, 'welcome', {}, { personality: s.personality }), 4000);
  }

  // Wellness nudges (water, stretch…). Not tasks, so they skip the engine.
  let lastBreak = Date.now();
  function checkBreak() {
    const s = settings.getAll();
    const snoozed = settings.getInternal('breakSnoozedUntil');
    if (!s.breakEveryMin || !pet.isVisible() || pet.isSleeping() || presenter.current) return;
    if (snoozed && snoozed > Date.now()) return;
    if (engine.heldUntil(new Date())) return;
    if (Date.now() - lastBreak < s.breakEveryMin * 60_000) return;
    lastBreak = Date.now();
    presenter.present({ kind: 'break', tip: dialogue.BREAK_TIPS[Math.floor(Math.random() * dialogue.BREAK_TIPS.length)] });
  }

  app.on('second-instance', () => openTasks('/tasks'));
  app.on('before-quit', () => { app.isQuitting = true; });
  app.on('window-all-closed', () => { /* keep running in the tray */ });

  app.whenReady().then(() => {
    const dataDir = app.getPath('userData');
    log.init(path.join(dataDir, 'logs'));
    log.info('starting', { version: app.getVersion(), autostart: process.argv.includes('--autostart') });

    try {
      db = openDb(path.join(dataDir, 'buddy.db'));
    } catch (err) {
      log.error('database failed to open', { error: err.message });
      dialog.showErrorBox('Desktop Buddy', `Could not open the database:\n${err.message}\n\nLogs: ${log.dir()}`);
      app.exit(1);
      return;
    }

    settings = createSettings(db);
    if (process.env.BUDDY_MUTE) settings.update({ sound: false, speech: false }); // automated tests
    tasks = createTaskService({
      db,
      shouldSync: () => settings.get('sync').enabled && !!getToken(),
      onChange: () => manager && manager.send('tasks:changed'),
    });
    bookmarks = createBookmarkService({ db, onChange: () => manager && manager.send('bookmarks:changed') });
    notes = createNoteService({ db });
    ai = createAi({ getKey: () => readSecret('anthropicKey'), setKey: (k) => writeSecret('anthropicKey', k), log });
    capture = createCapture({ clipboard, ClipboardItem, log, getOptions: () => settings.get('capture') });
    try {
      importLegacy({ db, dir: dataDir, tasks, settings, log });
    } catch (err) {
      log.error('legacy import failed', { error: err.message });
    }

    const icon = makeIcon(32);
    manager = createManager({ icon, log });
    presenter = createPresenter({ getPet: () => pet, settings, log, getEngine: () => engine, openTasks, icon });
    engine = createEngine({ db, tasks, settings, presenter, log });
    sync = createSync({
      db, tasks, settings, log, getToken, setToken,
      onStatus: (s) => manager.send('sync:status', s),
      onRemoteChange: () => { engine.wake(); manager.send('tasks:changed'); },
    });

    let welcomed = false;
    pet = createPetWindow({
      settings, log, hint,
      onClick: () => openTasks('/tasks'),
      onMenu: (win) => tray.popup(win),
      onDropText: saveDroppedText,
      onReady: () => {
        if (welcomed) return;
        welcomed = true;
        setTimeout(() => {
          const s = settings.getAll();
          if (pet.isVisible() && !pet.isSleeping() && !presenter.current) {
            pet.speak(dialogue.line(s.character, 'welcome', {}, { personality: s.personality }), 4500);
          }
        }, 1200);
      },
    });
    if (settings.get('startHidden') && process.argv.includes('--autostart')) settings.update({ buddyHidden: true });

    tray = createTray({ icon, settings, tasks, characters, getPet: () => pet, openTasks, pause, exit });

    // ---- IPC from the task manager window
    const handlers = createHandlers({
      tasks, settings, engine, sync, pet: () => pet, exportData, confirmDeleteAccount, previewBuddy,
      bookmarks, ai, confirmClearBookmarks, notes,
      copyText: (text) => clipboard.writeText(text),
      capture: {
        selection: (delay) => runCapture('selection', delay),
        ocr: (delay) => runCapture('ocr', delay),
        takePending: () => { const p = pendingCapture; pendingCapture = null; return p; },
        status: captureStatus,
        // Dropped text: same cleanup and checks as a capture; the source is the
        // window that was active at drop time (usually the drag source).
        inspectDrop: async (text) => {
          const { text: clean, truncated } = normalizeText(text);
          if (!clean) return { ok: false, message: 'Only text can be dropped here.' };
          const source = await capture.foreground();
          return {
            ok: true, text: clean, truncated, method: 'drop', warnings: sensitiveWarnings(clean),
            sourceApp: source?.sourceApp ?? null, sourceTitle: source?.sourceTitle ?? null, sourceUrl: source?.sourceUrl ?? null,
            sourceGuessed: !!source, capturedAt: new Date().toISOString(),
          };
        },
      },
      openExternal: (url) => shell.openExternal(url),
      openLogs: () => shell.openPath(log.dir()),
      info: () => ({
        version: app.getVersion(), dataDir, logDir: log.dir(), schemaVersion: schemaVersion(db),
        timeZone: settings.get('timeZone'), systemTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        characters: characters(), secureStorage: safeStorage.isEncryptionAvailable(),
      }),
    });
    for (const [channel, fn] of Object.entries(handlers)) {
      ipcMain.handle(channel, async (e, ...args) => {
        if (!manager.isSender(e.sender) || !manager.isAppUrl(e.senderFrame.url)) throw new Error('Forbidden');
        try {
          return await fn(...args);
        } catch (err) {
          if (err.code !== 'VALIDATION') log.warn('ipc call failed', { channel, error: err.message });
          throw new Error(err.message);
        }
      });
    }

    // ---- IPC from the pet window (reminder bubble)
    const fromPet = (e) => pet.window && e.sender === pet.window.webContents;
    ipcMain.on('alert:shown', (e, p) => { if (fromPet(e) && p && Number.isInteger(p.deliveryId)) presenter.shown(p); });
    ipcMain.on('alert:action', (e, p) => {
      if (!fromPet(e) || !p || typeof p.alertId !== 'string' || typeof p.action !== 'string') return;
      const minutes = Number.isInteger(p.minutes) && p.minutes >= 1 && p.minutes <= 1440 ? p.minutes : undefined;
      presenter.act(p.alertId, p.action, minutes);
    });

    settings.onChange((all, patch) => {
      manager.send('settings:changed', all);
      pet.applySettings(patch);
      if ('startWithWindows' in patch) app.setLoginItemSettings({ openAtLogin: !!patch.startWithWindows, args: ['--autostart'] });
      if (['character', 'theme', 'timeZone'].some((k) => k in patch)) sync.markPreferencesDirty();
      if ('quietHours' in patch || 'pausedUntil' in patch || 'missedPolicy' in patch) engine.wake();
      if ('capture' in patch) registerShortcuts();
    });

    engine.start();
    sync.start();
    setInterval(checkBreak, 60_000);

    // Sleep, hibernate and lock: re-evaluate reminders straight away.
    for (const evt of ['resume', 'unlock-screen']) {
      powerMonitor.on(evt, () => {
        log.info('system event', { evt });
        engine.wake();
        sync.syncNow();
      });
    }

    globalShortcut.register('Control+Alt+B', () => (pet.isVisible() ? pet.hide() : pet.show()));
    registerShortcuts();
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    try { engine && engine.stop(); sync && sync.stop(); pet && pet.destroy(); } catch { /* shutting down */ }
    try { db && db.close(); } catch { /* already closed */ }
    log.info('stopped');
  });
}
