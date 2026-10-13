// Offline-first sync. Local SQLite is the source of truth for reminders; this
// only mirrors changes to the cloud and pulls changes from other devices.
//
//   local write → outbox row (stable op_id) → POST /api/sync/push → delete row
//   GET /api/sync/changes?since=cursor → tasks.applyRemote (LWW, see taskService)
//
// Network failures and 5xx keep the operation and back off with jitter.
// Reminder delivery never waits on any of this.
const PUSH_BATCH = 50;
const PERIOD_MS = 60_000;
const DEBOUNCE_MS = 2_000;
const TIMEOUT_MS = 15_000;

const backoffMs = (attempts) => Math.min(30 * 60_000, 5_000 * 2 ** Math.min(attempts, 12)) * (0.5 + Math.random() * 0.5);

function createSync({
  db, tasks, settings, log, getToken, setToken,
  fetchImpl = globalThis.fetch, clock = () => new Date(),
  onStatus = () => {}, onRemoteChange = () => {},
}) {
  let syncing = false;
  let periodic = null;
  let debounce = null;
  let lastAttemptOk = null;

  const now = () => clock().toISOString();
  const cfg = () => settings.get('sync');
  const signedIn = () => !!getToken() && cfg().enabled;

  function status() {
    const s = cfg();
    return {
      enabled: s.enabled,
      signedIn: signedIn(),
      email: s.email,
      serverUrl: s.serverUrl,
      lastSyncAt: s.lastSyncAt,
      lastError: s.lastError,
      pending: db.prepare('SELECT COUNT(*) AS c FROM outbox').get().c,
      syncing,
      online: lastAttemptOk,
    };
  }

  async function request(method, path, body, { auth = true } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const headers = { 'content-type': 'application/json' };
    const token = auth ? getToken() : null;
    if (token) headers.authorization = `Bearer ${token}`;
    try {
      const res = await fetchImpl(`${cfg().serverUrl.replace(/\/$/, '')}${path}`, {
        method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal,
      });
      let data = null;
      if (res.status !== 204) { try { data = await res.json(); } catch { /* empty body */ } }
      if (!res.ok) {
        const err = new Error((data && data.error) || `Server error ${res.status}`);
        err.status = res.status;
        throw err;
      }
      return data;
    } catch (err) {
      if (err.name === 'AbortError') { const e = new Error('Server did not respond in time'); e.network = true; throw e; }
      if (!err.status) {
        const e = new Error(`Can't reach the sync server at ${cfg().serverUrl}. Check that it is running and the address is right.`);
        e.network = true;
        throw e;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  function handleAuthFailure(err) {
    if (err.status === 401) {
      log.warn('sync session expired; signing out of cloud sync');
      setToken(null);
      settings.update({ sync: { enabled: false, lastError: 'Session expired. Please sign in again.' } });
    }
  }

  async function push() {
    for (;;) {
      const ops = db.prepare(`SELECT * FROM outbox WHERE next_attempt_at IS NULL OR next_attempt_at <= ?
        ORDER BY created_at LIMIT ?`).all(now(), PUSH_BATCH);
      if (!ops.length) return;
      let data;
      try {
        data = await request('POST', '/api/sync/push', {
          ops: ops.map((o) => ({ opId: o.op_id, op: o.op, task: JSON.parse(o.payload) })),
        });
      } catch (err) {
        if (err.network || err.status >= 500 || err.status === 429) {
          const bump = db.prepare('UPDATE outbox SET attempts = attempts + 1, next_attempt_at = ?, last_error = ? WHERE op_id = ?');
          for (const o of ops) bump.run(new Date(clock().getTime() + backoffMs(o.attempts + 1)).toISOString(), err.message, o.op_id);
        }
        throw err;
      }
      for (const r of data.results) {
        db.prepare('DELETE FROM outbox WHERE op_id = ?').run(r.opId);
        if (r.status === 'applied' && r.task) tasks.setVersion(r.task.id, r.task.version);
        else if (r.status === 'conflict' && r.task) tasks.applyRemote(r.task);
        else if (r.status === 'rejected') log.warn('sync op rejected by server', { opId: r.opId, error: r.error });
      }
    }
  }

  async function pull() {
    let changed = 0;
    for (let page = 0; page < 100; page++) {
      const since = cfg().cursor;
      const q = new URLSearchParams({ limit: '200', ...(since ? { since } : {}) });
      const data = await request('GET', `/api/sync/changes?${q}`);
      for (const t of data.tasks) if (tasks.applyRemote(t)) changed++;
      settings.update({ sync: { cursor: data.cursor } });
      if (!data.hasMore) break;
    }
    return changed;
  }

  async function pushPreferences() {
    if (!settings.getInternal('prefsDirty')) return;
    const s = settings.getAll();
    await request('PATCH', '/api/me/preferences', { character: s.character, theme: s.theme, timeZone: s.timeZone });
    settings.setInternal('prefsDirty', false);
  }

  async function syncNow() {
    if (!signedIn() || syncing) return status();
    syncing = true;
    onStatus(status());
    let changed = 0;
    try {
      await pushPreferences();
      await push();
      changed = await pull();
      lastAttemptOk = true;
      settings.update({ sync: { lastSyncAt: now(), lastError: null } });
    } catch (err) {
      lastAttemptOk = err.network ? false : lastAttemptOk;
      handleAuthFailure(err);
      if (err.status !== 401) settings.update({ sync: { lastError: err.message } });
      log.warn('sync failed', { error: err.message, status: err.status });
    } finally {
      syncing = false;
      onStatus(status());
      if (changed) onRemoteChange();
    }
    return status();
  }

  // Call after any local change; batches bursts of edits into one sync.
  function notifyLocalChange() {
    if (!signedIn()) return;
    clearTimeout(debounce);
    debounce = setTimeout(syncNow, DEBOUNCE_MS);
  }

  function markPreferencesDirty() {
    settings.setInternal('prefsDirty', true);
    notifyLocalChange();
  }

  async function signIn({ email, password, serverUrl, register }) {
    settings.update({ sync: { serverUrl } });
    const data = await request('POST', `/api/auth/${register ? 'register' : 'login'}`, { email, password }, { auth: false });
    setToken(data.token);
    settings.update({ sync: { enabled: true, email: data.user.email, cursor: null, lastError: null } });
    const prefs = data.user.preferences || {};
    if (!register && prefs.character) settings.update({ character: prefs.character });
    else settings.setInternal('prefsDirty', true);
    tasks.enqueueAll();
    log.info('signed in to cloud sync', { register: !!register });
    await syncNow();
    return status();
  }

  function signOut() {
    setToken(null);
    db.prepare('DELETE FROM outbox').run();
    settings.update({ sync: { enabled: false, email: null, cursor: null, lastError: null, lastSyncAt: null } });
    onStatus(status());
    return status();
  }

  const exportCloud = () => request('GET', '/api/me/export');

  async function deleteAccount() {
    await request('DELETE', '/api/me');
    return signOut();
  }

  function start() {
    periodic = setInterval(syncNow, PERIOD_MS);
    syncNow();
  }

  function stop() {
    clearInterval(periodic);
    clearTimeout(debounce);
  }

  return { start, stop, syncNow, status, notifyLocalChange, markPreferencesDirty, signIn, signOut, exportCloud, deleteAccount, push, pull };
}

module.exports = { createSync, backoffMs };
