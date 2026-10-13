import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { makeStack, silentLog } from './helpers';
const require = createRequire(import.meta.url);
const { createMood } = require('../../electron/services/mood');
const { createWeather, kindOf } = require('../../electron/services/weather');
const { seasonFor } = require('../../electron/buddyLife');
const { settingsPatch, parse } = require('../../electron/services/validation');

function setupMood() {
  const stack = makeStack();
  const mood = createMood({ db: stack.db, tasks: stack.tasks, settings: stack.settings, now: () => stack.state.now.getTime() });
  const done = (title = 'task') => stack.tasks.complete(stack.tasks.create(stack.input({ title })).id);
  return { ...stack, mood, done };
}

describe('mood and treats', () => {
  it('earns one treat per completed task, counting from the first check', () => {
    const { mood, done } = setupMood();
    done('before');
    expect(mood.checkCompletions()).toBe(0); // existing history is not paid out
    const start = mood.summary().treats;
    done('a');
    done('b');
    expect(mood.checkCompletions()).toBe(2);
    expect(mood.summary().treats).toBe(start + 2);
    expect(mood.checkCompletions()).toBe(0);
  });

  it('feeding spends a treat and fills the buddy up; no treats, no food', () => {
    const { mood, advance } = setupMood();
    mood.checkCompletions();
    advance(10 * 60); // fullness drains ~4/hour
    const before = mood.summary();
    expect(before.fullness).toBe(30);
    const r = mood.feed();
    expect(r.ok).toBe(true);
    expect(r.treats).toBe(before.treats - 1);
    expect(r.fullness).toBe(55);
    while (mood.summary().treats > 0) mood.feed();
    expect(mood.feed().ok).toBe(false);
  });

  it('gets hungry over time', () => {
    const { mood, advance } = setupMood();
    expect(mood.summary().hungry).toBe(false);
    advance(12 * 60);
    expect(mood.summary().hungry).toBe(true);
  });

  it('sulks while tasks are overdue and cheers up when they get done', () => {
    const { mood, tasks, input, advance, done } = setupMood();
    const late = tasks.create(input({ title: 'Pay rent', dueAt: '2026-10-12T09:00:00.000Z' }));
    advance(120);
    const sulky = mood.summary();
    expect(sulky.overdue).toBe(1);
    expect(sulky.overdueTitle).toBe('Pay rent');
    expect(sulky.level).toBe('sulky');
    tasks.complete(late.id);
    done('x'); done('y');
    const happy = mood.summary();
    expect(happy.overdue).toBe(0);
    expect(happy.level).toBe('happy');
  });
});

describe('weather', () => {
  it('maps WMO codes to looks', () => {
    expect(kindOf(0)).toBe('clear');
    expect(kindOf(3)).toBe('cloudy');
    expect(kindOf(45)).toBe('fog');
    expect(kindOf(61)).toBe('rain');
    expect(kindOf(81)).toBe('rain');
    expect(kindOf(73)).toBe('snow');
    expect(kindOf(95)).toBe('storm');
  });

  it('fetches current conditions for the chosen location only', async () => {
    const { settings } = makeStack();
    const urls = [];
    const fetchImpl = async (url) => {
      urls.push(url);
      return { ok: true, json: async () => ({ current: { temperature_2m: 21.4, weather_code: 63, is_day: 1 } }) };
    };
    const updates = [];
    const weather = createWeather({ settings, log: silentLog, fetchImpl, onUpdate: (w) => updates.push(w) });
    expect(await weather.refresh()).toBe(null);
    expect(urls).toHaveLength(0); // no location yet → nothing sent

    settings.update({ weather: { location: { name: 'Bengaluru', lat: 12.97, lon: 77.59 } } });
    const w = await weather.refresh();
    expect(w).toMatchObject({ kind: 'rain', temp: 21, unit: 'C', place: 'Bengaluru', day: true });
    expect(urls[0]).toContain('latitude=12.97');
    expect(updates).toHaveLength(1);
  });

  it('validates the weather settings patch', () => {
    expect(() => parse(settingsPatch, { weather: { location: { name: 'X', lat: 200, lon: 0 } } })).toThrow();
    expect(parse(settingsPatch, { weather: { unit: 'F' }, followCursor: false })).toEqual({ weather: { unit: 'F' }, followCursor: false });
  });
});

describe('seasons', () => {
  it('Santa hat in December, pumpkin at the end of October', () => {
    expect(seasonFor(new Date(2026, 11, 3))).toBe('christmas');
    expect(seasonFor(new Date(2026, 9, 31))).toBe('halloween');
    expect(seasonFor(new Date(2026, 9, 13))).toBe(null);
  });
});
