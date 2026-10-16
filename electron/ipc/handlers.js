// IPC handlers for the task manager window. Pure functions of their
// dependencies so they can be unit-tested without Electron.
const v = require('../services/validation');
const { nextOccurrence, isRecurring } = require('../scheduler/recurrence');
const calendarImport = require('../services/calendarImport');

const MAX_CALENDAR_ITEMS = 1000;
const { z } = require('zod');

const captureDelay = z.number().int().min(0).max(10);
const onboardingCue = z.object({
  cue: z.enum(['show', 'say', 'wave', 'tray', 'home']),
  text: z.string().max(300).optional(),
  ms: z.number().int().min(500).max(15000).optional(),
});

// Phone mirror inputs. Serials and hosts go to adb as separate arguments
// (never a shell), but are still kept to the characters adb itself uses.
const phoneHost = z.string().regex(/^(?:\d{1,3}\.){3}\d{1,3}$|^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/, 'Enter the IP address shown on the phone');
const phonePort = z.number().int().min(1).max(65535);
const phoneSerial = z.string().regex(/^\w[\w.:-]{0,127}$/);
const phonePos = { x: z.number().finite(), y: z.number().finite(), width: z.number().int().min(1).max(8192), height: z.number().int().min(1).max(8192) };
const phoneInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('touch'), action: z.enum(['DOWN', 'UP', 'MOVE']), ...phonePos }),
  z.object({ kind: z.literal('scroll'), ...phonePos, hscroll: z.number().finite(), vscroll: z.number().finite() }),
  z.object({ kind: z.literal('text'), text: z.string().min(1).max(300) }),
  z.object({ kind: z.literal('key'), action: z.enum(['DOWN', 'UP']), keycode: z.number().int().min(0).max(400), metastate: z.number().int().min(0).max(0xffff).optional() }),
  z.object({ kind: z.literal('button'), button: z.enum(['back', 'home', 'recents', 'power', 'volumeUp', 'volumeDown', 'notifications', 'rotate']) }),
  z.object({ kind: z.literal('paste') }),
  z.object({ kind: z.literal('reset') }),
  z.object({ kind: z.literal('screen'), on: z.boolean() }),
]);
const phoneStart = z.object({
  quality: z.enum(['low', 'balanced', 'high']).optional(), screenOff: z.boolean().optional(),
  mode: z.enum(['mirror', 'separate']).optional(),
  startApp: z.string().regex(/^[a-zA-Z]\w*(\.[a-zA-Z]\w*)+$/).max(150).nullable().optional(),
});

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
  bookmarks, capture, ai, copyText, confirmClearBookmarks, notes, onboarding, progress, weather, buddyCare, updater, habits, community, phone, phoneNotifications = () => [], phoneBluetooth = () => ({ state: 'off', device: null }), clearPhoneNotifications = () => true,
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
    'calendar:import-ics': ({ icsText, defaultLeadMinutes = 10, category = 'Meeting' }) => {
      const events = calendarImport.parseIcs(icsText);
      const tz = settings?.getAll?.()?.timeZone || 'UTC';
      const result = calendarImport.importCalendarEvents({
        tasks,
        events,
        defaultLeadMinutes: Number(defaultLeadMinutes) || 10,
        category: String(category || 'Meeting'),
        timeZone: tz,
      });
      changed();
      return result;
    },
    'calendar:fetch-and-import': async ({ url, defaultLeadMinutes = 10, category = 'Meeting' }) => {
      const icsText = await calendarImport.fetchIcsFeed(url);
      const events = calendarImport.parseIcs(icsText);
      const tz = settings?.getAll?.()?.timeZone || 'UTC';
      const result = calendarImport.importCalendarEvents({
        tasks,
        events,
        defaultLeadMinutes: Number(defaultLeadMinutes) || 10,
        category: String(category || 'Meeting'),
        timeZone: tz,
      });
      changed();
      return result;
    },

    'progress:state': () => progress.state(),
    'progress:equip': (patch) => progress.equip(v.parse(v.equipInput, patch)),

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

    // ---- First-run welcome and tutorial
    'onboarding:cue': (c) => onboarding.cue(v.parse(onboardingCue, c)),
    'onboarding:finish': (opts) => onboarding.finish(v.parse(z.object({ startWithWindows: z.boolean() }), opts)),

    'sync:status': () => sync.status(),
    'sync:now': () => sync.syncNow(),
    'sync:sign-in': (creds, register) => sync.signIn({ ...v.parse(v.credentials, creds), register: register === true }),
    'sync:sign-out': () => sync.signOut(),
    'account:export': () => exportData(),
    'account:delete': async () => ((await confirmDeleteAccount()) ? sync.deleteAccount() : sync.status()),

    'app:info': () => info(),
    'app:open-external': (url) => { openExternal(v.parse(v.safeUrl.refine((s) => s !== ''), url)); return true; },
    'app:open-logs': () => openLogs(),

    'feedback:send': (input) => community.sendFeedback(v.parse(v.feedbackInput, input)),
    'errors:report': (input) => { community.reportCrash({ source: 'renderer', ...v.parse(v.errorReport, input) }); return true; },
    'announcements:list': () => {
      community?.refresh?.();
      return community ? community.announcements() : [];
    },
    'announcements:dismiss': (id) => community.dismiss(v.parse(z.string().min(1).max(64), id)),
    'updates:status': () => updater().status(),
    'updates:check': () => updater().check(),
    'updates:download': () => updater().download(),
    'updates:install': () => updater().quitAndInstall(),

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

    // ---- Weather and the buddy's mood/treats
    'weather:search': (q) => weather.search(v.parse(v.weatherQuery, q)),
    'weather:locate': () => weather.locate(),
    'weather:current': () => weather.current(),
    'buddy:stats': () => buddyCare.stats(),
    'buddy:feed': () => buddyCare.feed(),
    'buddy:speak': (text) => {
      const p = typeof pet === 'function' ? pet() : pet;
      if (p && typeof p.speak === 'function') {
        p.speak(v.parse(z.string().max(300), text), 4000);
      }
      return true;
    },
    'buddy:sit': () => {
      const p = typeof pet === 'function' ? pet() : pet;
      if (p && typeof p.sit === 'function') p.sit();
      return true;
    },
    'buddy:stretch': () => {
      const p = typeof pet === 'function' ? pet() : pet;
      if (p && typeof p.stretch === 'function') p.stretch();
      return true;
    },
    'buddy:celebrate': (text) => {
      const p = typeof pet === 'function' ? pet() : pet;
      if (p && typeof p.celebrate === 'function') p.celebrate(text ? v.parse(z.string().max(300), text) : undefined);
      return true;
    },

    // ---- Habits
    'habits:list': (opts) => habits.list(opts ?? {}),
    'habits:get': (id) => habits.get(v.parse(v.id, id)),
    'habits:create': (input) => habits.create(v.parse(v.habitInput, input)),
    'habits:update': (id, patch) => habits.update(v.parse(v.id, id), v.parse(v.habitPatch, patch)),
    'habits:delete': (id) => habits.remove(v.parse(v.id, id)),
    'habits:complete': (id, date, note) => habits.complete(v.parse(v.id, id), date ? v.parse(v.isoDate, date) : undefined, note ?? ''),
    'habits:uncomplete': (id, date) => habits.uncomplete(v.parse(v.id, id), date ? v.parse(v.isoDate, date) : undefined),
    'habits:range': (from, to) => habits.rangeCompletions(v.parse(v.isoDate, from), v.parse(v.isoDate, to)),
    'habits:streak': (id) => habits.streak(v.parse(v.id, id)),

    // ---- Phone mirror (local network only)
    'phone:status': () => phone.status(),
    'phone:notifications': () => phoneNotifications(),
    'phone:bt-status': () => phoneBluetooth(),
    'phone:notifications-clear': () => clearPhoneNotifications(),
    'phone:devices': () => phone.devices(),
    'phone:discover': () => phone.discover(),
    'phone:pair': (host, port, code) => phone.pair(v.parse(phoneHost, host), v.parse(phonePort, port), v.parse(z.string().regex(/^\d{6}$/, 'The pairing code is 6 digits'), code)),
    'phone:qr-start': () => phone.qrStart(),
    'phone:qr-cancel': () => phone.qrCancel(),
    'phone:connect': (host, port) => phone.connect(v.parse(phoneHost, host), v.parse(phonePort, port)),
    'phone:disconnect': (serial) => phone.disconnect(v.parse(phoneSerial, serial)),
    'phone:start': (serial, opts) => phone.start(v.parse(phoneSerial, serial), v.parse(phoneStart, opts ?? {})),
    'phone:stop': () => phone.stop(),
    'phone:view': (on) => phone.setViewing(v.parse(z.boolean(), on)),
    'phone:input': (evt) => phone.input(v.parse(phoneInput, evt)),
  };
}

module.exports = { createHandlers, calendarRange };
