import { DateTime } from 'luxon';

export const WEEKDAYS = [
  { n: 1, short: 'Mon' }, { n: 2, short: 'Tue' }, { n: 3, short: 'Wed' }, { n: 4, short: 'Thu' },
  { n: 5, short: 'Fri' }, { n: 6, short: 'Sat' }, { n: 7, short: 'Sun' },
];

// When a task is "on": its next reminder, else its due date.
export const whenOf = (t) => t.nextOccurrenceAt || t.dueAt;

export function isOverdue(t, now = Date.now()) {
  return t.status === 'PENDING' && !!t.dueAt && !t.nextOccurrenceAt && Date.parse(t.dueAt) < now;
}

export function isToday(iso, now = new Date()) {
  return !!iso && new Date(iso).toDateString() === now.toDateString();
}

export function relative(iso, now = Date.now()) {
  const diff = Date.parse(iso) - now;
  const abs = Math.abs(diff);
  const m = Math.round(abs / 60_000);
  const h = Math.round(abs / 3_600_000);
  const d = Math.round(abs / 86_400_000);
  if (m < 1) return 'now';
  const span = m < 60 ? `${m} min` : h < 24 ? `${h} h` : `${d} d`;
  return diff > 0 ? `in ${span}` : `${span} ago`;
}

export function formatWhen(iso) {
  const d = new Date(iso);
  const now = new Date();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Today ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' })} ${time}`;
}

// Converts a wall-clock date + time in `zone` to a UTC ISO string.
export function toUtcIso(date, time, zone) {
  if (!date) return null;
  const dt = DateTime.fromISO(`${date}T${time || '09:00'}`, { zone });
  return dt.isValid ? dt.toUTC().toISO() : null;
}

// Splits a UTC ISO into wall-clock date/time fields in `zone`.
export function fromUtcIso(iso, zone) {
  if (!iso) return { date: '', time: '' };
  const dt = DateTime.fromISO(iso, { zone: 'utc' }).setZone(zone);
  return { date: dt.toFormat('yyyy-LL-dd'), time: dt.toFormat('HH:mm') };
}

export const allTimeZones = () => {
  try { return Intl.supportedValuesOf('timeZone'); } catch { return ['UTC']; }
};

export const systemZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
