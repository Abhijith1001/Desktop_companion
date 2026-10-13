// App updates from GitHub Releases via electron-updater.
//   auto: download in the background, install on next quit (or "Restart now").
//   ask:  tell the user a version is available and download only if they agree.
// Only active in the packaged app; dev builds report "unsupported".
const CHECK_EVERY_MS = 6 * 60 * 60_000;

function createUpdater({ app, dialog, settings, log, getWindow, onStatus = () => {} }) {
  let autoUpdater = null;
  let status = { state: app.isPackaged ? 'idle' : 'unsupported', version: null, progress: null, error: null };
  let timer = null;
  let prompted = null; // version we've already asked about, so checks don't nag

  const mode = () => settings.get('updates')?.mode || 'auto';
  const set = (patch) => { status = { ...status, ...patch }; onStatus(status); };

  async function ask(opts) {
    const win = getWindow();
    const res = win && !win.isDestroyed() ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
    return res.response === 0;
  }

  async function offerRestart(version) {
    if (await ask({
      type: 'info', buttons: ['Restart now', 'Later'], defaultId: 0, cancelId: 1,
      title: 'Update ready', message: `Desktop Buddy ${version} is ready to install.`,
      detail: 'Restart now to update, or it will install the next time you quit.',
    })) quitAndInstall();
  }

  function start() {
    if (!app.isPackaged) return;
    ({ autoUpdater } = require('electron-updater'));
    autoUpdater.logger = { info: (m) => log.info('updater', { m: String(m) }), warn: (m) => log.warn('updater', { m: String(m) }), error: (m) => log.error('updater', { m: String(m) }), debug() {} };
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => set({ state: 'checking', error: null }));
    autoUpdater.on('update-not-available', () => set({ state: 'latest', version: null }));
    autoUpdater.on('update-available', async (info) => {
      set({ state: autoUpdater.autoDownload ? 'downloading' : 'available', version: info.version });
      if (autoUpdater.autoDownload || prompted === info.version) return;
      prompted = info.version;
      if (await ask({
        type: 'info', buttons: ['Download', 'Not now'], defaultId: 0, cancelId: 1,
        title: 'Update available', message: `Desktop Buddy ${info.version} is available.`,
        detail: `You have ${app.getVersion()}. Download the update now?`,
      })) download();
    });
    autoUpdater.on('download-progress', (p) => set({ state: 'downloading', progress: Math.round(p.percent) }));
    autoUpdater.on('update-downloaded', (info) => {
      set({ state: 'ready', version: info.version, progress: 100 });
      offerRestart(info.version);
    });
    autoUpdater.on('error', (err) => set({ state: 'error', error: err?.message || String(err) }));

    setTimeout(check, 15_000); // let startup settle first
    timer = setInterval(check, CHECK_EVERY_MS);
  }

  async function check() {
    if (!autoUpdater || ['downloading', 'ready'].includes(status.state)) return status;
    autoUpdater.autoDownload = mode() === 'auto';
    try { await autoUpdater.checkForUpdates(); } catch (err) { set({ state: 'error', error: err.message }); }
    return status;
  }

  async function download() {
    if (!autoUpdater) return status;
    set({ state: 'downloading', progress: 0 });
    try { await autoUpdater.downloadUpdate(); } catch (err) { set({ state: 'error', error: err.message }); }
    return status;
  }

  function quitAndInstall() {
    if (!autoUpdater || status.state !== 'ready') return false;
    app.isQuitting = true;
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
    return true;
  }

  return {
    start, check, download, quitAndInstall,
    status: () => ({ ...status, current: app.getVersion(), mode: mode() }),
    stop: () => clearInterval(timer),
  };
}

module.exports = { createUpdater };
