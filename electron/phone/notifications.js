// Watches a connected phone's notifications (adb `dumpsys notification`):
//  - keeps the current list (app, title, text) for the Phone page's panel;
//  - reports new ones so the buddy can say who wrote. The buddy's bubble is
//    visible to anyone near the screen, so it only ever gets the app and
//    sender, never the text.
// Nothing is stored or sent anywhere; the list lives in memory while connected.

// Chat apps the buddy announces by default (the "all apps" setting widens it).
const CHAT_APPS = {
  'com.whatsapp': 'WhatsApp',
  'com.whatsapp.w4b': 'WhatsApp Business',
  'org.telegram.messenger': 'Telegram',
  'com.instagram.android': 'Instagram',
  'com.google.android.apps.messaging': 'Messages',
  'com.android.mms': 'Messages',
  'com.facebook.orca': 'Messenger',
  'org.thoughtcrime.securesms': 'Signal',
  'com.snapchat.android': 'Snapchat',
};
// Friendly names for other common apps; anything else is named from its package.
const APP_NAMES = {
  ...CHAT_APPS,
  'com.google.android.gm': 'Gmail',
  'com.google.android.youtube': 'YouTube',
  'com.reddit.frontpage': 'Reddit',
  'com.linkedin.android': 'LinkedIn',
  'com.twitter.android': 'X',
  'com.facebook.katana': 'Facebook',
  'com.amazon.mShop.android.shopping': 'Amazon',
  'in.amazon.mShop.android.shopping': 'Amazon',
  'com.spotify.music': 'Spotify',
  'com.netflix.mediaclient': 'Netflix',
  'com.google.android.calendar': 'Calendar',
  'com.google.android.dialer': 'Phone',
  'com.android.dialer': 'Phone',
  'com.slack': 'Slack',
  'com.microsoft.teams': 'Teams',
  'com.google.android.apps.nbu.paisa.user': 'Google Pay',
  'net.one97.paytm': 'Paytm',
  'com.phonepe.app': 'PhonePe',
};
// System noise that isn't something the user would call "a notification".
const SYSTEM_PKGS = new Set(['android', 'com.android.systemui']);
const SKIP_WORDS = new Set(['com', 'org', 'net', 'in', 'android', 'app', 'apps', 'mobile', 'client', 'google', 'user']);
const POLL_MS = 5000;
const MAX_LIST = 60;
const MAX_HISTORY = 100;
const MAX_TEXT = 500;

// Just the lines parseNotifications reads (one shell string, run by the phone's sh).
const FILTERED_DUMP = "dumpsys notification --noredact | grep -E '^  [A-Za-z]|NotificationRecord\\(|^ +flags=|^ +when=|android\\.(title|text|subText)='";

function appName(pkg) {
  if (APP_NAMES[pkg]) return APP_NAMES[pkg];
  const word = String(pkg).split('.').reverse().find((w) => !SKIP_WORDS.has(w.toLowerCase())) || pkg;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

// `android.text=String (Hello there)` → "Hello there". Multi-line values only
// keep their first line (the dump is filtered line by line).
function field(block, name) {
  const m = block.match(new RegExp(`\\n\\s*android\\.${name}=\\S+ \\((.*)`));
  if (!m) return null;
  const v = m[1].replace(/\)\s*$/, '').trim();
  return v ? v.slice(0, MAX_TEXT) : null;
}

// "Notification List:" section → [{ key, pkg, title, text, subText, when, summary, ongoing }]
function parseNotifications(dump) {
  const text = String(dump).replace(/\r\n?/g, '\n');
  const start = text.indexOf('Notification List:');
  if (start < 0) return [];
  // The list ends at the next top-level (two-space) heading.
  const rest = text.slice(start + 18);
  const endMatch = rest.match(/\n {2}\S/);
  const section = endMatch ? rest.slice(0, endMatch.index) : rest;
  return section.split(/\n\s*NotificationRecord\(/).slice(1).map((block) => {
    // Built from the header's first line: WhatsApp tags can contain a line
    // break, which splits the rest of the header (and its key=) onto the next line.
    const head = block.slice(0, block.indexOf('\n') >>> 0);
    const pkg = head.match(/pkg=(\S+)/)?.[1];
    const user = head.match(/user=UserHandle\{(-?\d+)\}/)?.[1];
    const id = head.match(/\bid=(-?\d+)/)?.[1];
    const tag = head.match(/\btag=(\S*)/)?.[1] ?? '';
    const key = pkg && id != null ? `${user}|${pkg}|${id}|${tag}` : null;
    const flags = block.match(/\n\s*flags=(\S*)/)?.[1] || '';
    const when = Number(block.match(/\n\s*when=(\d+)/)?.[1] || 0);
    block = `\n${block}`;
    return {
      key, pkg, when,
      title: field(block, 'title'), text: field(block, 'text'), subText: field(block, 'subText'),
      summary: /GROUP_SUMMARY/.test(flags), ongoing: /ONGOING_EVENT|FOREGROUND_SERVICE/.test(flags),
    };
  }).filter((n) => n.key && n.pkg);
}

// What the panel shows: real notifications, newest first.
function visibleList(list) {
  return list
    .filter((n) => !n.summary && !n.ongoing && !SYSTEM_PKGS.has(n.pkg) && (n.title || n.text))
    .sort((a, b) => b.when - a.when)
    .slice(0, MAX_LIST)
    .map((n) => ({ id: `${n.key}@${n.when}`, app: appName(n.pkg), pkg: n.pkg, title: n.title, text: n.text, subText: n.subText, when: n.when || null }));
}

// Decides which notifications are new since the last poll. The first poll
// only remembers what's already there, so old ones aren't announced.
function createTracker() {
  let seen = null;
  return function diff(list, { allApps = false } = {}) {
    const items = visibleList(list).filter((n) => n.title && (allApps || CHAT_APPS[n.pkg]));
    const ids = new Set(items.map((n) => n.id));
    const fresh = seen ? items.filter((n) => !seen.has(n.id)) : [];
    seen = ids;
    return fresh.map((n) => ({ app: n.app, from: cleanTitle(n.title) }));
  };
}

// WhatsApp groups show "Group: Sender" or "Group (3 messages): Sender";
// keep it short for a speech bubble.
function cleanTitle(title) {
  return String(title).replace(/\s*\(\d+ (?:new )?messages?\)/i, '').replace(/\s+/g, ' ').trim().slice(0, 60);
}

// announce() → 'off' | 'chat' | 'all'. onList gets the panel list whenever it changes.
// getBluetooth() → { id, items } from the Buddy Link app, used instead of adb while connected.
function createNotificationWatcher({ adb, getSerial, onMessage, onList = () => {}, log, enabled = () => true, announce = () => 'chat', getBluetooth = () => null }) {
  let timer = null;
  let tracker = createTracker();
  let lastSerial = null;
  let busy = false;
  let current = [];
  let currentSig = '';
  // Everything seen this session, so a notification stays listed after it's
  // opened or swiped away on the phone (then marked `cleared`). Memory only.
  let history = new Map();

  function setList(list) {
    const sig = list.map((n) => `${n.id}${n.cleared ? '-' : ''}`).join(',');
    if (sig === currentSig) return;
    current = list;
    currentSig = sig;
    onList(list);
  }

  // "Clear all" hides what's listed now; still-present ones don't come back.
  let dismissed = new Set();

  function clear() {
    dismissed = new Set(history.keys());
    history = new Map();
    setList([]);
    return true;
  }

  function merge(all) {
    const live = all.filter((n) => !dismissed.has(n.id));
    // Forget dismissals for notifications that have left the phone.
    dismissed = new Set(all.map((n) => n.id).filter((id) => dismissed.has(id)));
    const ids = new Set(live.map((n) => n.id));
    for (const [id, n] of history) if (!ids.has(id) && !n.cleared) history.set(id, { ...n, cleared: true });
    for (const n of live) history.set(n.id, { ...n, cleared: false });
    const list = [...history.values()].sort((a, b) => (b.when || 0) - (a.when || 0)).slice(0, MAX_HISTORY);
    history = new Map(list.map((n) => [n.id, n]));
    return list;
  }

  async function poll() {
    if (busy) return;
    const bt = getBluetooth();
    if (!bt && !enabled()) return;
    busy = true;
    try {
      const serial = bt ? bt.id : await getSerial();
      // A different phone starts a fresh list; a dropped connection keeps it.
      if (serial && serial !== lastSerial) { tracker = createTracker(); history = new Map(); }
      if (serial !== lastSerial) lastSerial = serial;
      if (!serial) return;
      // Filtered on the phone: a few KB instead of a ~1 MB dump every poll,
      // which would otherwise compete with the mirror's video on Wi-Fi.
      const parsed = bt ? bt.items : parseNotifications(await adb(['-s', serial, 'shell', FILTERED_DUMP], { timeout: 10_000 }));
      setList(merge(visibleList(parsed)));
      const mode = announce();
      const fresh = tracker(parsed, { allApps: mode === 'all' });
      if (mode === 'off') return;
      // Several at once: one line, not a flurry of bubbles.
      if (fresh.length === 1) onMessage(fresh[0]);
      else if (fresh.length > 1) onMessage({ app: fresh[0].app, from: null, count: fresh.length, names: [...new Set(fresh.map((f) => f.from))] });
    } catch (err) {
      log.warn('phone notifications', { error: err.message.slice(0, 200) });
      tracker = createTracker();
    } finally {
      busy = false;
    }
  }

  return {
    start() { if (!timer) timer = setInterval(poll, POLL_MS); },
    stop() { clearInterval(timer); timer = null; },
    list: () => current,
    clear,
    poll,
  };
}

module.exports = { createNotificationWatcher, parseNotifications, visibleList, createTracker, cleanTitle, appName, CHAT_APPS };
