// IPC handlers for the task manager window. Pure functions of their
// dependencies so they can be unit-tested without Electron.
const v = require('../services/validation');
const { nextOccurrence, isRecurring } = require('../scheduler/recurrence');

const MAX_CALENDAR_ITEMS = 1000;
const captureDelay = require('zod').z.number().int().min(0).max(10);

// Expands tasks (including every occurrence of recurring ones) within [from, to].
function calendarRange(list, from, to) {
  const out = [];
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  for (const t of list) {
    if (!t.dueAt) continue;
    const base = { taskId: t.id, title: t.title, priority: t.priority, status: t.status, category: t.category };
    if (!isRecurring(t.recurrence) || t.status !== 'PENDING') {
      const at = t.status === 'PENDING' ? t.nextOccurrenceAt || t.dueAt : t.dueAt;
      const ms = Date.parse(at);
      if (ms >= fromMs && ms <= toMs) out.push({ ...base, at });
      continue;
    }
    const rule = { due_at: t.dueAt, time_zone: t.timeZone, recurrence: t.recurrence };
    let cursor = new Date(fromMs - 1).toISOString();
    for (let i = 0; i < 400 && out.length < MAX_CALENDAR_ITEMS; i++) {
      const at = nextOccurrence(rule, cursor);
      if (!at || Date.parse(at) > toMs) break;
      out.push({ ...base, at, upcoming: Date.parse(at) >= Date.parse(t.nextOccurrenceAt || at) });
      cursor = at;
    }
  }
  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

function createHandlers({
  tasks, settings, engine, sync, pet, info, exportData, confirmDeleteAccount, openExternal, openLogs, previewBuddy,
  bookmarks, capture, ai, copyText, confirmClearBookmarks, notes,
}) {
  const changed = () => { engine.wake(); sync.notifyLocalChange(); };

  return {
    'tasks:list': () => tasks.list(),
    'tasks:get': (id) => tasks.get(v.parse(v.id, id)),
    'tasks:create': (input) => { const t = tasks.create(v.parse(v.taskInput, input)); changed(); return t; },
    'tasks:update': (id, input) => { const t = tasks.update(v.parse(v.id, id), v.parse(v.taskInput, input)); changed(); return t; },
    'tasks:delete': (id) => { tasks.remove(v.parse(v.id, id)); changed(); return true; },
    'tasks:complete': (id) => { const t = tasks.complete(v.parse(v.id, id)); changed(); return t; },
    'tasks:reopen': (id) => { const t = tasks.reopen(v.parse(v.id, id)); changed(); return t; },
    'tasks:snooze': (id, minutes) => { const until = tasks.snooze(v.parse(v.id, id), v.parse(v.snoozeMinutes, minutes)); changed(); return until; },

    'calendar:range': (from, to) => {
      const f = v.parse(v.isoDateTime, from);
      const t = v.parse(v.isoDateTime, to);
      if (Date.parse(t) - Date.parse(f) > 100 * 86_400_000) throw new Error('Range too large');
      return calendarRange(tasks.list(), f, t);
    },

    'settings:get': () => settings.getAll(),
    'settings:update': (patch) => settings.update(v.parse(v.settingsPatch, patch)),

    'reminders:pause': (minutes) => {
      const pausedUntil = minutes == null ? null : new Date(Date.now() + v.parse(v.snoozeMinutes, minutes) * 60_000).toISOString();
      settings.update({ pausedUntil });
      engine.wake();
      return pausedUntil;
    },
    'reminders:status': () => ({ ...engine.stats(), pausedUntil: settings.get('pausedUntil') }),

    'buddy:show': () => { pet().show(); return true; },
    'buddy:hide': () => { pet().hide(); return true; },
    'buddy:preview': () => { previewBuddy(); return true; },

    'sync:status': () => sync.status(),
    'sync:now': () => sync.syncNow(),
    'sync:sign-in': (creds, register) => sync.signIn({ ...v.parse(v.credentials, creds), register: register === true }),
    'sync:sign-out': () => sync.signOut(),
    'account:export': () => exportData(),
    'account:delete': async () => ((await confirmDeleteAccount()) ? sync.deleteAccount() : sync.status()),

    'app:info': () => info(),
    'app:open-external': (url) => { openExternal(v.parse(v.safeUrl.refine((s) => s !== ''), url)); return true; },
    'app:open-logs': () => openLogs(),

    // ---- Bookmarks (local only)
    'bookmarks:list': (filter) => bookmarks.list(v.parse(v.bookmarkFilter, filter ?? {})),
    'bookmarks:get': (id) => bookmarks.get(v.parse(v.id, id)),
    'bookmarks:create': (input, opts) => bookmarks.create(v.parse(v.bookmarkInput, input), { allowDuplicate: opts?.allowDuplicate === true }),
    'bookmarks:update': (id, patch) => bookmarks.update(v.parse(v.id, id), v.parse(v.bookmarkPatch, patch)),
    'bookmarks:delete': (id) => bookmarks.remove(v.parse(v.id, id)),
    'bookmarks:clear': async () => ((await confirmClearBookmarks()) ? bookmarks.clearAll() : null),
    'bookmarks:facets': () => bookmarks.facets(),
    'bookmarks:copy': (id) => { copyText(bookmarks.get(v.parse(v.id, id)).text); return true; },
    'bookmarks:open-source': (id) => {
      const b = bookmarks.get(v.parse(v.id, id));
      if (!b.sourceUrl) throw new Error('This bookmark has no source link');
      openExternal(v.parse(v.safeUrl.refine((s) => s !== ''), b.sourceUrl));
      return true;
    },

    // ---- Capture (each call is one user-initiated capture)
    'capture:selection': (delaySeconds) => capture.selection(v.parse(captureDelay, delaySeconds ?? 0)),
    'capture:ocr': (delaySeconds) => capture.ocr(v.parse(captureDelay, delaySeconds ?? 0)),
    'capture:pending': () => capture.takePending(),
    'capture:inspect-drop': (text) => capture.inspectDrop(v.parse(v.droppedText, text)),
    'capture:status': () => capture.status(),

    // ---- Notepad (local only)
    'notes:list': (q) => notes.list(q == null ? undefined : v.parse(require('zod').z.string().max(200), q)),
    'notes:get': (id) => notes.get(v.parse(v.id, id)),
    'notes:create': (input) => notes.create(v.parse(v.noteInput, input ?? {})),
    'notes:update': (id, patch) => notes.update(v.parse(v.id, id), v.parse(v.noteInput, patch)),
    'notes:delete': (id) => notes.remove(v.parse(v.id, id)),
    'notes:copy': (id) => { copyText(notes.get(v.parse(v.id, id)).body); return true; },

    // ---- Optional AI
    'ai:status': () => ai.status(),
    'ai:set-key': (key) => ai.setKey(key == null ? null : v.parse(v.apiKey, key)),
    'ai:ask': (req) => ai.ask(v.parse(v.aiRequest, req)),
  };
}

module.exports = { createHandlers, calendarRange };
