// Tamagotchi-style buddy stats. Light by design: the buddy never "dies" and is
// never mean, it just perks up when tasks get done and sulks a little while
// tasks are overdue.
//   fullness  0–100, drains slowly over time, topped up by treats
//   treats    earned one per completed task, spent by feeding
//   mood      derived from overdue tasks, recent completions, fullness and petting
const DRAIN_PER_HOUR = 4;
const TREAT_FULLNESS = 25;
const TREAT_CAP = 20;
const PET_BONUS_MS = 20 * 60_000;

function createMood({ db, tasks, settings, now = () => Date.now() }) {
  const save = (s) => settings.setInternal('buddyStats', s);
  // Saved on first use so hunger counts from then, not from every read.
  const load = () => {
    const saved = settings.getInternal('buddyStats');
    if (saved) return { pettedAt: 0, ...saved };
    const fresh = { fullness: 70, treats: 1, seenCompleted: null, lastUpdate: now(), pettedAt: 0 };
    save(fresh);
    return { ...fresh };
  };

  function drained() {
    const s = load();
    const hours = Math.max(0, now() - s.lastUpdate) / 3_600_000;
    s.fullness = Math.max(0, s.fullness - hours * DRAIN_PER_HOUR);
    s.lastUpdate = now();
    return s;
  }

  const completedCount = () => db.prepare("SELECT COUNT(*) AS n FROM activity WHERE type = 'completed'").get().n;
  const completedSince = (ms) => db.prepare("SELECT COUNT(*) AS n FROM activity WHERE type = 'completed' AND at >= ?")
    .get(new Date(ms).toISOString()).n;

  function overdue() {
    const t = now();
    return tasks.list().filter((x) => {
      const at = x.status === 'PENDING' && (x.nextOccurrenceAt || x.dueAt);
      return at && Date.parse(at) < t;
    });
  }

  // Number of tasks completed since the last check; each one earns a treat.
  function checkCompletions() {
    const s = drained();
    const n = completedCount();
    let earned = 0;
    if (s.seenCompleted == null || n < s.seenCompleted) s.seenCompleted = n;
    else if (n > s.seenCompleted) {
      earned = n - s.seenCompleted;
      s.treats = Math.min(TREAT_CAP, s.treats + earned);
      s.seenCompleted = n;
    }
    save(s);
    return earned;
  }

  function feed() {
    const s = drained();
    if (s.treats <= 0) { save(s); return { ok: false, ...summary(s) }; }
    s.treats -= 1;
    s.fullness = Math.min(100, s.fullness + TREAT_FULLNESS);
    save(s);
    return { ok: true, ...summary(s) };
  }

  function pet() {
    const s = drained();
    s.pettedAt = now();
    save(s);
  }

  function summary(s = drained()) {
    const late = overdue();
    const recent = completedSince(now() - 24 * 3_600_000);
    let score = 55 + 10 * Math.min(recent, 4) - 15 * Math.min(late.length, 3) + (s.fullness - 50) * 0.4;
    if (now() - s.pettedAt < PET_BONUS_MS) score += 10;
    score = Math.round(Math.max(0, Math.min(100, score)));
    const level = late.length && score < 50 ? 'sulky' : score >= 70 ? 'happy' : score <= 35 ? 'sulky' : 'ok';
    return {
      mood: score, level, fullness: Math.round(s.fullness), hungry: s.fullness < 25, treats: s.treats,
      overdue: late.length, overdueTitle: late[0]?.title ?? null, completedToday: recent,
    };
  }

  return { checkCompletions, feed, pet, summary, overdue };
}

const MOOD_EMOJI = { happy: '😊', ok: '🙂', sulky: '😤' };

module.exports = { createMood, MOOD_EMOJI };
