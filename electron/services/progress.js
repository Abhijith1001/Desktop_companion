// Gamification derived from the activity log: XP, levels, streaks, badges and
// unlockable cosmetics. Nothing extra is tracked per task; badges are stored
// once earned so momentary ones ("Inbox zero") stay unlocked.
const { DateTime } = require('luxon');

const XP_PER_TASK = 10;
const XP_PER_BADGE = 25;

// Total XP needed to reach a level: 0, 50, 150, 300, 500, …
const xpForLevel = (n) => 25 * n * (n - 1);
const levelFor = (xp) => { let n = 1; while (xp >= xpForLevel(n + 1)) n++; return n; };

const STAGES = [
  { from: 1, name: 'Baby' }, { from: 3, name: 'Buddy' }, { from: 6, name: 'Pro' }, { from: 10, name: 'Legend' },
];
const stageFor = (level) => [...STAGES].reverse().find((s) => level >= s.from).name;

const ACHIEVEMENTS = [
  { id: 'first-task', emoji: '🎉', name: 'First task', description: 'Complete your first task', test: (s) => s.total >= 1 },
  { id: 'tasks-10', emoji: '🔟', name: 'Getting going', description: 'Complete 10 tasks', test: (s) => s.total >= 10 },
  { id: 'tasks-50', emoji: '🚀', name: 'On a roll', description: 'Complete 50 tasks', test: (s) => s.total >= 50 },
  { id: 'tasks-100', emoji: '💯', name: 'Centurion', description: 'Complete 100 tasks', test: (s) => s.total >= 100 },
  { id: 'streak-3', emoji: '🔥', name: '3-day streak', description: 'Finish something 3 days in a row', test: (s) => s.longestStreak >= 3 },
  { id: 'streak-7', emoji: '⚡', name: '7-day streak', description: 'Finish something 7 days in a row', test: (s) => s.longestStreak >= 7 },
  { id: 'streak-30', emoji: '🌟', name: '30-day streak', description: 'Finish something 30 days in a row', test: (s) => s.longestStreak >= 30 },
  { id: 'inbox-zero', emoji: '📭', name: 'Inbox zero', description: 'Clear everything due today', test: (s) => s.inboxZero },
  { id: 'busy-day', emoji: '🏃', name: 'Busy bee', description: 'Complete 10 tasks in one day', test: (s) => s.bestDay >= 10 },
  { id: 'early-bird', emoji: '🌅', name: 'Early bird', description: 'Complete a task before 8 am', test: (s) => s.early },
  { id: 'night-owl', emoji: '🦉', name: 'Night owl', description: 'Complete a task after 10 pm', test: (s) => s.late },
];

// Cosmetics. `requires` is a badge id or `level:N`. Accessory art lives in
// characters.js (window.ACCESSORIES), background art in the renderer.
const REWARDS = [
  { id: 'party-hat', kind: 'accessory', name: 'Party hat', requires: 'first-task' },
  { id: 'bow', kind: 'accessory', name: 'Bow', requires: 'streak-3' },
  { id: 'flower', kind: 'accessory', name: 'Flower', requires: 'tasks-10' },
  { id: 'star', kind: 'accessory', name: 'Lucky star', requires: 'streak-7' },
  { id: 'wizard', kind: 'accessory', name: 'Wizard hat', requires: 'tasks-50' },
  { id: 'crown', kind: 'accessory', name: 'Crown', requires: 'level:10' },
  { id: 'halo', kind: 'accessory', name: 'Halo', requires: 'streak-30' },
  { id: 'meadow', kind: 'background', name: 'Meadow', requires: null },
  { id: 'sunset', kind: 'background', name: 'Sunset', requires: 'level:3' },
  { id: 'night', kind: 'background', name: 'Starry night', requires: 'night-owl' },
  { id: 'ocean', kind: 'background', name: 'Ocean', requires: 'inbox-zero' },
  { id: 'space', kind: 'background', name: 'Outer space', requires: 'level:6' },
];

const describeRequirement = (req) => {
  if (!req) return 'Always available';
  if (req.startsWith('level:')) return `Reach level ${req.slice(6)}`;
  return `Badge: ${ACHIEVEMENTS.find((a) => a.id === req).name}`;
};

function createProgress({ db, settings, clock = () => new Date() }) {
  const zone = () => settings.get('timeZone') || 'UTC';
  const local = (iso) => DateTime.fromISO(iso, { zone: 'utc' }).setZone(zone());

  // One completion per task per local day, so reopen/complete can't farm XP.
  function completions() {
    const seen = new Set();
    const out = [];
    const rows = db.prepare(`SELECT a.task_id, a.at, t.category FROM activity a LEFT JOIN tasks t ON t.id = a.task_id
      WHERE a.type = 'completed' ORDER BY a.at`).all();
    for (const r of rows) {
      const dt = local(r.at);
      const day = dt.toISODate();
      const key = `${r.task_id}|${day}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ day, hour: dt.hour, category: r.category || '' });
    }
    return out;
  }

  function streaks(days) {
    const today = DateTime.fromJSDate(clock()).setZone(zone()).startOf('day');
    const set = new Set(days);
    const sorted = [...set].sort();
    let longest = 0;
    let run = 0;
    let prev = null;
    for (const d of sorted) {
      const dt = DateTime.fromISO(d, { zone: zone() });
      run = prev && dt.diff(prev, 'days').days === 1 ? run + 1 : 1;
      longest = Math.max(longest, run);
      prev = dt;
    }
    // Current streak may end today or yesterday (today isn't over yet).
    let cursor = set.has(today.toISODate()) ? today : today.minus({ days: 1 });
    let current = 0;
    while (set.has(cursor.toISODate())) { current++; cursor = cursor.minus({ days: 1 }); }
    return { current, longest, today };
  }

  // Nothing left that is due today or earlier (undated one-off tasks count).
  function dueTodayCount(today) {
    const end = today.endOf('day').toUTC().toISO();
    return db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE status = 'PENDING' AND deleted_at IS NULL
      AND (COALESCE(next_occurrence_at, due_at) IS NULL OR COALESCE(next_occurrence_at, due_at) <= ?)`).get(end).n;
  }

  function stats() {
    const list = completions();
    const perDay = new Map();
    for (const c of list) perDay.set(c.day, (perDay.get(c.day) || 0) + 1);
    const { current, longest, today } = streaks([...perDay.keys()]);
    const completedToday = perDay.get(today.toISODate()) || 0;
    return {
      list, perDay, today, total: list.length, streak: current, longestStreak: longest, completedToday,
      bestDay: Math.max(0, ...perDay.values()),
      early: list.some((c) => c.hour < 8),
      late: list.some((c) => c.hour >= 22),
      inboxZero: completedToday > 0 && dueTodayCount(today) === 0,
    };
  }

  const stored = () => settings.getInternal('achievements');

  // Earned badges = previously stored ones plus any whose test passes now.
  function earned(s) {
    const have = { ...(stored() || {}) };
    for (const a of ACHIEVEMENTS) if (!have[a.id] && a.test(s)) have[a.id] = clock().toISOString();
    return have;
  }

  function compute() {
    const s = stats();
    const badges = earned(s);
    const xp = s.total * XP_PER_TASK + Object.keys(badges).length * XP_PER_BADGE;
    const level = levelFor(xp);
    const unlocked = (req) => !req || (req.startsWith('level:') ? level >= Number(req.slice(6)) : !!badges[req]);
    return { s, badges, xp, level, unlocked };
  }

  function recap(c) {
    const end = c.s.today;
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = end.minus({ days: i });
      days.push({ date: d.toISODate(), label: d.toFormat('ccc'), count: c.s.perDay.get(d.toISODate()) || 0 });
    }
    const from = days[0].date;
    const week = c.s.list.filter((x) => x.day >= from);
    const cats = new Map();
    for (const x of week) if (x.category) cats.set(x.category, (cats.get(x.category) || 0) + 1);
    const best = days.reduce((a, b) => (b.count > a.count ? b : a), days[0]);
    const newBadges = ACHIEVEMENTS.filter((a) => c.badges[a.id] && local(c.badges[a.id]).toISODate() >= from).map((a) => a.id);
    return {
      from, to: days[6].date, days, total: week.length,
      bestDay: best.count ? best : null,
      topCategory: [...cats.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null,
      newBadges,
    };
  }

  function state() {
    const c = compute();
    const all = settings.getAll();
    return {
      xp: c.xp, level: c.level, stage: stageFor(c.level),
      levelStartXp: xpForLevel(c.level), nextLevelXp: xpForLevel(c.level + 1),
      streak: c.s.streak, longestStreak: c.s.longestStreak, completedToday: c.s.completedToday, total: c.s.total,
      achievements: ACHIEVEMENTS.map(({ test, ...a }) => ({ ...a, unlockedAt: c.badges[a.id] || null })),
      rewards: REWARDS.map((r) => ({ ...r, unlocked: c.unlocked(r.requires), requirement: describeRequirement(r.requires) })),
      equipped: { accessory: all.accessory, background: all.background },
      recap: recap(c),
    };
  }

  // Stores new badges and level-ups; returns them as events to celebrate.
  // The very first run records existing history silently instead of
  // flooding long-time users with every badge at once.
  function check() {
    const first = stored() == null;
    const before = stored() || {};
    const c = compute();
    const events = [];
    for (const a of ACHIEVEMENTS) {
      if (c.badges[a.id] && !before[a.id]) events.push({ kind: 'achievement', id: a.id, emoji: a.emoji, name: a.name });
    }
    const lastLevel = settings.getInternal('level') || 1;
    if (c.level > lastLevel) {
      const rewards = REWARDS.filter((r) => r.requires?.startsWith('level:') && Number(r.requires.slice(6)) > lastLevel
        && Number(r.requires.slice(6)) <= c.level).map((r) => r.name);
      events.push({ kind: 'level', level: c.level, stage: stageFor(c.level), rewards });
    }
    for (const e of events.filter((x) => x.kind === 'achievement')) {
      e.rewards = REWARDS.filter((r) => r.requires === e.id).map((r) => r.name);
    }
    if (events.length || first) {
      settings.setInternal('achievements', c.badges);
      settings.setInternal('level', c.level);
    }
    return first ? [] : events;
  }

  function equip({ accessory, background }) {
    const { unlocked } = compute();
    const patch = {};
    const find = (id, kind) => {
      const r = REWARDS.find((x) => x.id === id && x.kind === kind);
      if (!r) throw new Error(`Unknown ${kind}`);
      if (!unlocked(r.requires)) throw new Error(`${r.name} is still locked — ${describeRequirement(r.requires).toLowerCase()}`);
      return id;
    };
    if (accessory !== undefined) patch.accessory = accessory === null ? null : find(accessory, 'accessory');
    if (background !== undefined) patch.background = find(background, 'background');
    if (Object.keys(patch).length) settings.update(patch);
    return state();
  }

  return { state, check, equip };
}

module.exports = { createProgress, ACHIEVEMENTS, REWARDS, xpForLevel, levelFor };
