import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { open } = require('../../electron/database/db');
const { createSettings } = require('../../electron/services/settings');
const { createTaskService } = require('../../electron/services/tasks');
const { createProgress, levelFor, xpForLevel } = require('../../electron/services/progress');

function setup(start = '2026-10-12T06:00:00.000Z') {
  const state = { now: new Date(start) };
  const clock = () => new Date(state.now);
  const db = open(':memory:');
  const settings = createSettings(db);
  settings.update({ timeZone: 'UTC' });
  const tasks = createTaskService({ db, clock });
  const progress = createProgress({ db, settings, clock });
  const input = (title) => ({
    title, description: '', notes: '', link: '', category: 'work', priority: 'MEDIUM',
    dueAt: null, timeZone: 'UTC', recurrence: null, leadMinutes: 0,
  });
  const done = (title = 'task') => tasks.complete(tasks.create(input(title)).id);
  const days = (n) => { state.now = new Date(state.now.getTime() + n * 86_400_000); };
  return { db, settings, tasks, progress, done, days, input };
}

describe('progress', () => {
  it('levels follow the XP curve', () => {
    expect(levelFor(0)).toBe(1);
    expect(levelFor(49)).toBe(1);
    expect(levelFor(50)).toBe(2);
    expect(levelFor(xpForLevel(10))).toBe(10);
  });

  it('first check records existing history silently, later checks report new badges', () => {
    const { progress, done } = setup();
    done();
    expect(progress.check()).toEqual([]);
    expect(progress.state().achievements.find((a) => a.id === 'first-task').unlockedAt).toBeTruthy();
    for (let i = 0; i < 9; i++) done();
    const events = progress.check();
    expect(events.map((e) => e.id || e.kind)).toContain('tasks-10');
    expect(events.find((e) => e.id === 'tasks-10').rewards).toEqual(['Flower']);
    expect(progress.check()).toEqual([]);
  });

  it('counts streaks across days and keeps them alive until the day ends', () => {
    const { progress, done, days } = setup();
    done(); days(1); done(); days(1); done();
    expect(progress.state()).toMatchObject({ streak: 3, longestStreak: 3 });
    days(1); // nothing done yet today: streak still counts
    expect(progress.state().streak).toBe(3);
    days(1); // missed a whole day
    expect(progress.state()).toMatchObject({ streak: 0, longestStreak: 3 });
  });

  it('does not award XP twice for reopening and re-completing the same task', () => {
    const { progress, tasks, input } = setup();
    const t = tasks.create(input('a'));
    tasks.complete(t.id);
    tasks.reopen(t.id);
    tasks.complete(t.id);
    expect(progress.state().total).toBe(1);
  });

  it('inbox zero unlocks once nothing due today is left, and stays unlocked', () => {
    const { progress, tasks, input, done } = setup();
    progress.check();
    const open = tasks.create(input('left over'));
    done();
    expect(progress.check().some((e) => e.id === 'inbox-zero')).toBe(false);
    tasks.complete(open.id);
    expect(progress.check().some((e) => e.id === 'inbox-zero')).toBe(true);
    tasks.create(input('new'));
    expect(progress.state().achievements.find((a) => a.id === 'inbox-zero').unlockedAt).toBeTruthy();
  });

  it('only equips unlocked rewards', () => {
    const { progress, settings, done } = setup();
    expect(() => progress.equip({ accessory: 'party-hat' })).toThrow(/locked/);
    done();
    progress.equip({ accessory: 'party-hat' });
    expect(settings.get('accessory')).toBe('party-hat');
    expect(() => progress.equip({ background: 'space' })).toThrow(/level 6/);
    expect(() => progress.equip({ accessory: 'nope' })).toThrow(/Unknown/);
  });

  it('weekly recap counts the last 7 days', () => {
    const { progress, done, days } = setup();
    done(); done(); days(3); done(); days(10); done();
    const r = progress.state().recap;
    expect(r.total).toBe(1);
    expect(r.days).toHaveLength(7);
    expect(r.topCategory).toBe('work');
  });
});
