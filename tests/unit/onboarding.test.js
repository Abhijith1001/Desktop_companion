import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';
import { makeStack, silentLog } from './helpers.js';
const require = createRequire(import.meta.url);
const { createOnboarding, SAMPLES, nextAt } = require('../../electron/onboarding');

function setup() {
  const s = makeStack();
  const pet = { speak: vi.fn(), show: vi.fn(), wave: vi.fn(), goTo: vi.fn(), walkIn: vi.fn(), isVisible: () => true };
  const manager = { open: vi.fn(), send: vi.fn() };
  const ob = createOnboarding({
    settings: s.settings, tasks: s.tasks, log: silentLog,
    getPet: () => pet, getManager: () => manager, onTasksChanged: vi.fn(),
  });
  return { s, ob, pet, manager };
}

describe('onboarding', () => {
  it('seeds sample tasks once on a fresh install', () => {
    const { s, ob } = setup();
    expect(ob.prepare({ autostart: false })).toBe(true);
    expect(s.tasks.list().map((t) => t.title).sort()).toEqual(SAMPLES.map((x) => x.title).sort());
    expect(ob.holdEntrance()).toBe(true);
    ob.prepare({ autostart: false }); // second launch before finishing: no duplicates
    expect(s.tasks.list()).toHaveLength(SAMPLES.length);
  });

  it('skips the flow for upgrading users who already have tasks', () => {
    const { s, ob } = setup();
    s.tasks.create(s.input({ title: 'Existing' }));
    expect(ob.prepare({ autostart: false })).toBe(false);
    expect(s.settings.get('onboarded')).toBe(true);
    expect(s.tasks.list()).toHaveLength(1);
  });

  it('does not run the entrance when started with Windows', () => {
    const { ob } = setup();
    expect(ob.prepare({ autostart: true })).toBe(false);
    expect(ob.holdEntrance()).toBe(false);
  });

  it('finishing records consent for Start with Windows', () => {
    const { s, ob, pet } = setup();
    ob.prepare({ autostart: false });
    ob.finish({ startWithWindows: true });
    expect(s.settings.get('onboarded')).toBe(true);
    expect(s.settings.get('startWithWindows')).toBe(true);
    expect(pet.wave).toHaveBeenCalled();
  });

  it('routes cues to the buddy and events to the window', () => {
    const { ob, pet, manager } = setup();
    ob.cue({ cue: 'say', text: 'Hello' });
    expect(pet.speak).toHaveBeenCalledWith('Hello', 4500);
    ob.cue({ cue: 'tray', text: 'Down here' });
    expect(pet.goTo).toHaveBeenCalledWith('tray', expect.any(Object));
    ob.event('dragged');
    expect(manager.send).toHaveBeenCalledWith('onboarding:event', 'dragged');
  });

  it('nextAt picks the next occurrence of a local time', () => {
    const now = new Date(2026, 9, 13, 12, 0);
    expect(new Date(nextAt([11, 0], now)).getDate()).toBe(14);
    expect(new Date(nextAt([15, 0], now)).getDate()).toBe(13);
  });
});
