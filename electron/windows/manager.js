// The task manager window (React app). One instance; hides on close, and is
// destroyed after staying hidden a while so its renderer's memory is freed.
const path = require('path');
const { app, BrowserWindow, shell } = require('electron');

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const RELEASE_AFTER_MS = 60_000;

function isAppUrl(url) {
  if (DEV_URL) return url.startsWith(DEV_URL);
  return url.startsWith('file://');
}

function createManager({ icon, log, onHide = () => {} }) {
  let win = null;
  let releaseTimer = null;
  const alive = () => win && !win.isDestroyed();
  const cancelRelease = () => { clearTimeout(releaseTimer); releaseTimer = null; };

  function create(route) {
    win = new BrowserWindow({
      width: 1100, height: 760, minWidth: 720, minHeight: 520,
      title: 'Desktop Buddy', icon, show: false, autoHideMenuBar: true,
      backgroundColor: '#fffaf3',
      webPreferences: {
        preload: path.join(__dirname, '../preload/app.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true,
      },
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, url) => { if (!isAppUrl(url)) e.preventDefault(); });
    win.once('ready-to-show', () => win.show());
    win.on('close', (e) => {
      if (app.isQuitting) return;
      e.preventDefault();
      win.hide();
    });
    win.on('hide', () => {
      cancelRelease();
      releaseTimer = setTimeout(() => { releaseTimer = null; if (alive() && !win.isVisible()) win.destroy(); }, RELEASE_AFTER_MS);
      onHide();
    });
    win.on('show', cancelRelease);
    win.on('closed', () => { cancelRelease(); win = null; });
    win.webContents.on('render-process-gone', (_e, d) => log.error('manager renderer crashed', { reason: d.reason }));

    const hash = route || '/tasks';
    if (DEV_URL) win.loadURL(`${DEV_URL}#${hash}`);
    else win.loadFile(path.join(__dirname, '../../dist/index.html'), { hash });
  }

  function open(route) {
    if (alive()) {
      if (route) win.webContents.send('app:navigate', route);
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      return;
    }
    create(route);
  }

  const send = (ch, payload) => { if (alive()) win.webContents.send(ch, payload); };
  const isSender = (wc) => alive() && wc === win.webContents;

  return { open, send, isSender, isAppUrl, get window() { return alive() ? win : null; } };
}

module.exports = { createManager };
