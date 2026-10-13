import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { nextOccurrence, describe: describeRule } = require('../../electron/scheduler/recurrence');

const task = (due_at, recurrence, time_zone = 'Asia/Kolkata') => ({ due_at, time_zone, recurrence });

describe('nextOccurrence', () => {
  it('one-off: returns due time only while it is in the future', () => {
    const t = task('2026-10-12T10:00:00.000Z', null);
    expect(nextOccurrence(t, '2026-10-12T09:00:00.000Z')).toBe('2026-10-12T10:00:00.000Z');
    expect(nextOccurrence(t, '2026-10-12T10:00:00.000Z')).toBeNull();
  });

  it('daily keeps the same local time', () => {
    // 09:00 IST = 03:30 UTC
    const t = task('2026-10-12T03:30:00.000Z', { type: 'daily' });
    expect(nextOccurrence(t, '2026-10-12T03:30:00.000Z')).toBe('2026-10-13T03:30:00.000Z');
    expect(nextOccurrence(t, '2026-10-20T12:00:00.000Z')).toBe('2026-10-21T03:30:00.000Z');
  });

  it('first occurrence is the anchor itself when asked from before it', () => {
    const t = task('2026-10-12T03:30:00.000Z', { type: 'daily' });
    expect(nextOccurrence(t, '2026-10-01T00:00:00.000Z')).toBe('2026-10-12T03:30:00.000Z');
  });

  it('weekdays: Monday to Friday skips the weekend', () => {
    // Fri 2026-10-16 09:00 IST
    const t = task('2026-10-16T03:30:00.000Z', { type: 'weekdays', weekdays: [1, 2, 3, 4, 5] });
    expect(nextOccurrence(t, '2026-10-16T03:30:00.000Z')).toBe('2026-10-19T03:30:00.000Z'); // Monday
  });

  it('weekly defaults to the anchor weekday', () => {
    const t = task('2026-10-16T03:30:00.000Z', { type: 'weekly' }); // Friday
    expect(nextOccurrence(t, '2026-10-16T04:00:00.000Z')).toBe('2026-10-23T03:30:00.000Z');
  });

  it('every N days counts from the anchor date', () => {
    const t = task('2026-10-12T03:30:00.000Z', { type: 'every_n_days', interval: 3 });
    expect(nextOccurrence(t, '2026-10-12T04:00:00.000Z')).toBe('2026-10-15T03:30:00.000Z');
    expect(nextOccurrence(t, '2026-10-15T04:00:00.000Z')).toBe('2026-10-18T03:30:00.000Z');
  });

  it('every N weeks on selected weekdays', () => {
    // Mon 2026-10-12, every 2 weeks on Mon + Thu
    const t = task('2026-10-12T03:30:00.000Z', { type: 'every_n_weeks', interval: 2, weekdays: [1, 4] });
    expect(nextOccurrence(t, '2026-10-12T04:00:00.000Z')).toBe('2026-10-15T03:30:00.000Z'); // Thu same week
    expect(nextOccurrence(t, '2026-10-15T04:00:00.000Z')).toBe('2026-10-26T03:30:00.000Z'); // Mon, 2 weeks later
  });

  it('respects the until date (inclusive)', () => {
    const t = task('2026-10-12T03:30:00.000Z', { type: 'daily', until: '2026-10-13' });
    expect(nextOccurrence(t, '2026-10-12T04:00:00.000Z')).toBe('2026-10-13T03:30:00.000Z');
    expect(nextOccurrence(t, '2026-10-13T04:00:00.000Z')).toBeNull();
  });

  it('keeps local wall-clock time across a DST change', () => {
    // New York, 9:00 local. EDT (UTC-4) before 2026-11-01, EST (UTC-5) after.
    const t = task('2026-10-30T13:00:00.000Z', { type: 'daily' }, 'America/New_York');
    expect(nextOccurrence(t, '2026-10-31T14:00:00.000Z')).toBe('2026-11-01T14:00:00.000Z');
    expect(nextOccurrence(t, '2026-11-01T14:00:00.000Z')).toBe('2026-11-02T14:00:00.000Z');
  });

  it('times inside a spring-forward gap move forward instead of disappearing', () => {
    // 2:30 AM does not exist in New York on 2027-03-14.
    const t = task('2027-03-13T07:30:00.000Z', { type: 'daily' }, 'America/New_York'); // 2:30 EST
    const next = nextOccurrence(t, '2027-03-13T08:00:00.000Z');
    expect(next).not.toBeNull();
    expect(Date.parse(next)).toBeGreaterThan(Date.parse('2027-03-14T06:00:00.000Z'));
    expect(Date.parse(next)).toBeLessThan(Date.parse('2027-03-14T08:00:00.000Z'));
  });

  it('keeps the first occurrence when the anchor has seconds', () => {
    const t = task('2026-10-12T10:09:01.900Z', { type: 'daily' }, 'UTC');
    expect(nextOccurrence(t, '2026-10-12T10:08:58.928Z')).toBe('2026-10-12T10:09:01.900Z');
    expect(nextOccurrence(t, '2026-10-12T10:09:01.900Z')).toBe('2026-10-13T10:09:01.900Z');
  });

  it('describes rules for the UI', () => {
    expect(describeRule({ type: 'weekdays', weekdays: [1, 3, 5] })).toBe('Every Mon, Wed, Fri');
    expect(describeRule(null)).toBe('Once');
  });
});
