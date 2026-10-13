// Shared by the desktop app and the cloud server. Exported as a factory taking
// luxon so each package resolves its own copy of the dependency.
//
// Recurrence rules are evaluated in the task's IANA time zone so "9:00 AM every
// weekday" stays 9:00 local across daylight-saving changes. All returned
// timestamps are UTC ISO strings.
//
// rule = null | {
//   type: 'none' | 'daily' | 'weekly' | 'weekdays' | 'every_n_days' | 'every_n_weeks',
//   interval?: number,        // N for every_n_*
//   weekdays?: number[],      // 1 = Monday … 7 = Sunday (weekly, weekdays, every_n_weeks)
//   until?: 'YYYY-MM-DD',     // inclusive end date in the task's time zone
// }

module.exports = function createRecurrence({ DateTime, IANAZone }) {
const MAX_SCAN_DAYS = 3 * 366;

const toIso = (dt) => dt.toUTC().toISO();
const isRecurring = (rule) => !!rule && rule.type && rule.type !== 'none';
const isValidZone = (zone) => typeof zone === 'string' && IANAZone.isValidZone(zone);

function matchesDay(rule, anchor, day) {
  const weekdays = rule.weekdays && rule.weekdays.length ? rule.weekdays : [anchor.weekday];
  switch (rule.type) {
    case 'daily':
      return true;
    case 'weekly':
    case 'weekdays':
      return weekdays.includes(day.weekday);
    case 'every_n_days': {
      const n = Math.max(1, rule.interval || 1);
      const diff = Math.round(day.startOf('day').diff(anchor.startOf('day'), 'days').days);
      return diff >= 0 && diff % n === 0;
    }
    case 'every_n_weeks': {
      const n = Math.max(1, rule.interval || 1);
      const weeks = Math.round(day.startOf('week').diff(anchor.startOf('week'), 'weeks').weeks);
      return weeks >= 0 && weeks % n === 0 && weekdays.includes(day.weekday);
    }
    default:
      return false;
  }
}

/**
 * First occurrence strictly after `afterIso`, or null when there is none.
 * @param {{due_at: string, time_zone: string, recurrence: object|null}} task
 */
function nextOccurrence(task, afterIso) {
  if (!task.due_at) return null;
  const zone = isValidZone(task.time_zone) ? task.time_zone : 'UTC';
  const anchor = DateTime.fromISO(task.due_at, { zone: 'utc' }).setZone(zone);
  const after = DateTime.fromISO(afterIso, { zone: 'utc' }).setZone(zone);
  const rule = task.recurrence;

  if (!isRecurring(rule)) return anchor > after ? toIso(anchor) : null;

  const until = rule.until ? DateTime.fromISO(rule.until, { zone }).endOf('day') : null;
  const start = (after > anchor ? after : anchor).startOf('day');

  for (let i = 0; i <= MAX_SCAN_DAYS; i++) {
    const day = start.plus({ days: i });
    if (until && day > until) return null;
    if (!matchesDay(rule, anchor, day)) continue;
    // Luxon moves times that fall in a DST gap forward to the next valid instant.
    const candidate = day.set({ hour: anchor.hour, minute: anchor.minute, second: anchor.second, millisecond: anchor.millisecond });
    if (candidate < anchor || candidate <= after) continue;
    if (until && candidate > until) return null;
    return toIso(candidate);
  }
  return null;
}

/** Human-readable summary, e.g. "Every Mon, Wed, Fri". */
function describe(rule) {
  if (!isRecurring(rule)) return 'Once';
  const names = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const days = (rule.weekdays || []).slice().sort().map((d) => names[d]).join(', ');
  const until = rule.until ? ` until ${rule.until}` : '';
  switch (rule.type) {
    case 'daily': return `Daily${until}`;
    case 'weekly': return `Weekly${days ? ` on ${days}` : ''}${until}`;
    case 'weekdays': return `Every ${days}${until}`;
    case 'every_n_days': return `Every ${rule.interval} days${until}`;
    case 'every_n_weeks': return `Every ${rule.interval} weeks${days ? ` on ${days}` : ''}${until}`;
    default: return 'Custom';
  }
}

return { nextOccurrence, isRecurring, isValidZone, describe, toIso };
};
