import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';
import { makeStack } from './helpers.js';
const require = createRequire(import.meta.url);
const { createHandlers } = require('../../electron/ipc/handlers');

function setup() {
  const s = makeStack();
  const sync = { notifyLocalChange: vi.fn(), status: vi.fn(() => ({})), signIn: vi.fn(async (x) => x) };
  const openExternal = vi.fn();
  const h = createHandlers({
    tasks: s.tasks, settings: s.settings, engine: { ...s.engine, wake: vi.fn() }, sync,
    pet: () => ({ show() {}, hide() {} }), info: () => ({}), exportData: vi.fn(), confirmDeleteAccount: vi.fn(),
    openExternal, openLogs: vi.fn(), previewBuddy: vi.fn(),
  });
  return { s, h, sync, openExternal };
}

const valid = {
  title: 'Review emails', dueAt: '2026-10-13T03:30:00.000Z', timeZone: 'Asia/Kolkata',
  recurrence: { type: 'weekdays', weekdays: [1, 2, 3, 4, 5] }, leadMinutes: 10,
};

describe('IPC validation', () => {
  it('creates a task from valid input and fills defaults', () => {
    const { h, sync } = setup();
    const t = h['tasks:create'](valid);
    expect(t).toMatchObject({ title: 'Review emails', priority: 'MEDIUM', leadMinutes: 10, recurrenceText: 'Every Mon, Tue, Wed, Thu, Fri' });
    expect(sync.notifyLocalChange).toHaveBeenCalled();
  });

  it.each([
    ['empty title', { ...valid, title: '   ' }],
    ['huge title', { ...valid, title: 'x'.repeat(500) }],
    ['bad time zone', { ...valid, timeZone: 'Nowhere/City' }],
    ['bad date', { ...valid, dueAt: 'tomorrow-ish' }],
    ['javascript link', { ...valid, link: 'javascript:alert(1)' }],
    ['weekdays rule without days', { ...valid, recurrence: { type: 'weekdays', weekdays: [] } }],
    ['recurring without a date', { ...valid, dueAt: null }],
    ['negative lead time', { ...valid, leadMinutes: -5 }],
    ['unknown priority', { ...valid, priority: 'URGENT!!' }],
  ])('rejects %s', (_name, input) => {
    const { h } = setup();
    expect(() => h['tasks:create'](input)).toThrow();
  });

  it('rejects non-uuid ids', () => {
    const { h } = setup();
    expect(() => h['tasks:delete']("1' OR 1=1")).toThrow(/id/);
  });

  it('rejects unknown or out-of-range settings', () => {
    const { h } = setup();
    expect(() => h['settings:update']({ isAdmin: true })).toThrow();
    expect(() => h['settings:update']({ volume: 7 })).toThrow();
    expect(() => h['settings:update']({ quietHours: { enabled: true, start: '25:00', end: '07:00' } })).toThrow();
    expect(h['settings:update']({ character: 'tom', volume: 0.3 })).toMatchObject({ character: 'tom', volume: 0.3 });
  });

  it('only opens http(s) links externally', () => {
    const { h, openExternal } = setup();
    expect(() => h['app:open-external']('file:///C:/Windows/System32/calc.exe')).toThrow();
    expect(() => h['app:open-external']('')).toThrow();
    h['app:open-external']('https://example.com');
    expect(openExternal).toHaveBeenCalledWith('https://example.com');
  });

  it('requires https for non-local sync servers', () => {
    const { h } = setup();
    expect(() => h['sync:sign-in']({ email: 'a@b.co', password: 'longenough', serverUrl: 'http://evil.example.com' })).toThrow(/https/);
    expect(() => h['sync:sign-in']({ email: 'a@b.co', password: 'short', serverUrl: 'https://api.example.com' })).toThrow();
  });

  it('pause takes minutes or null', () => {
    const { h, s } = setup();
    expect(h['reminders:pause'](30)).toBeTruthy();
    expect(h['reminders:pause'](null)).toBeNull();
    expect(s.settings.get('pausedUntil')).toBeNull();
    expect(() => h['reminders:pause']('forever')).toThrow();
  });
});

describe('calendar range', () => {
  it('expands recurring tasks into dated occurrences', () => {
    const { h } = setup();
    h['tasks:create']({ title: 'Standup', dueAt: '2026-10-12T03:30:00.000Z', timeZone: 'Asia/Kolkata', recurrence: { type: 'weekdays', weekdays: [1, 2, 3, 4, 5] } });
    h['tasks:create']({ title: 'One-off', dueAt: '2026-10-14T10:00:00.000Z', timeZone: 'Asia/Kolkata' });
    const items = h['calendar:range']('2026-10-12T00:00:00.000Z', '2026-10-18T23:59:59.000Z');
    expect(items.filter((i) => i.title === 'Standup')).toHaveLength(5);
    expect(items.filter((i) => i.title === 'One-off')).toHaveLength(1);
    expect(() => h['calendar:range']('2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z')).toThrow(/too large/);
  });
});
