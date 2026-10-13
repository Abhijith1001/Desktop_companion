// Talks to the server's public endpoints: send feedback, send crash reports
// (only when the user opted in) and fetch announcements. Uses the same server
// as sync but never needs an account. Failures are logged and swallowed;
// nothing here may break the app.
const os = require('os');

const TIMEOUT_MS = 10_000;
const ANNOUNCE_EVERY_MS = 6 * 60 * 60_000;
const MAX_CRASHES_PER_SESSION = 10;

function createCommunity({ settings, log, appVersion, fetchImpl = globalThis.fetch, onAnnouncements = () => {} }) {
  const base = () => String(settings.get('sync').serverUrl || '').replace(/\/+$/, '');
  const osName = `Windows ${os.release()}`;
  let announcements = [];
  let timer = null;
  let sentCrashes = 0;
  const seen = new Set();

  async function post(path, body) {
    const res = await fetchImpl(`${base()}/api/public${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, appVersion, os: osName }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Server error (${res.status})`);
    return data;
  }

  async function sendFeedback({ kind, message, email }) {
    try {
      await post('/feedback', { kind, message, email: email || '' });
      return true;
    } catch (err) {
      log.warn('feedback failed', { error: err.message });
      throw new Error(err.name === 'TimeoutError' || err.name === 'AbortError'
        ? 'The server took too long to answer (it may be waking up). Please try again in a minute.'
        : `Couldn't send feedback: ${err.message}`);
    }
  }

  // Fire and forget. Duplicates within a session are dropped.
  function reportCrash({ source = 'main', message = '', stack = '' }) {
    if (!settings.get('crashReports')) return;
    const key = `${source}|${message}|${String(stack).slice(0, 200)}`;
    if (seen.has(key) || sentCrashes >= MAX_CRASHES_PER_SESSION) return;
    seen.add(key);
    sentCrashes += 1;
    post('/crash', { source, message: String(message).slice(0, 1000), stack: String(stack).slice(0, 8000) })
      .catch((err) => log.warn('crash report failed', { error: err.message }));
  }

  async function refreshAnnouncements() {
    try {
      const res = await fetchImpl(`${base()}/api/public/announcements`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) return announcements;
      const data = await res.json();
      announcements = Array.isArray(data.announcements) ? data.announcements : [];
      onAnnouncements(visibleAnnouncements());
    } catch (err) {
      log.debug?.('announcements fetch failed', { error: err.message });
    }
    return announcements;
  }

  const dismissed = () => settings.getInternal('dismissedAnnouncements') || [];
  const visibleAnnouncements = () => announcements.filter((a) => !dismissed().includes(a.id));
  function dismiss(id) {
    settings.setInternal('dismissedAnnouncements', [...dismissed(), id].slice(-100));
    onAnnouncements(visibleAnnouncements());
    return true;
  }

  return {
    sendFeedback,
    reportCrash,
    announcements: visibleAnnouncements,
    dismiss,
    start() {
      setTimeout(refreshAnnouncements, 15_000);
      timer = setInterval(refreshAnnouncements, ANNOUNCE_EVERY_MS);
    },
    stop() { clearInterval(timer); },
  };
}

module.exports = { createCommunity };
