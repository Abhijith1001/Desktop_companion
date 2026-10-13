import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { open } = require('../../electron/database/db');
const { createSettings } = require('../../electron/services/settings');
const { createTaskService } = require('../../electron/services/tasks');
const { createEngine } = require('../../electron/scheduler/engine');

export const silentLog = { info() {}, warn() {}, error() {}, debug() {} };

// Builds the full local stack on an in-memory database with a controllable clock.
export function makeStack({ start = '2026-10-12T08:00:00.000Z', sync = false } = {}) {
  const state = { now: new Date(start) };
  const clock = () => new Date(state.now);
  const db = open(':memory:');
  const settings = createSettings(db);
  settings.update({ timeZone: 'Asia/Kolkata' });
  const tasks = createTaskService({ db, clock, shouldSync: () => sync });

  const presented = [];
  const queued = new Set();
  const presenter = {
    present: (alert) => { presented.push(alert); if (alert.deliveryId) queued.add(alert.deliveryId); },
    isQueued: (id) => queued.has(id),
  };
  const engine = createEngine({
    db, tasks, settings, presenter, log: silentLog, clock,
    setTimer: () => 0, clearTimer: () => {},
  });

  const advance = (minutes) => { state.now = new Date(state.now.getTime() + minutes * 60_000); };
  const input = (over = {}) => ({
    title: 'Test', description: '', notes: '', link: '', category: '', priority: 'MEDIUM',
    dueAt: null, timeZone: 'Asia/Kolkata', recurrence: null, leadMinutes: 0, ...over,
  });
  return { db, settings, tasks, engine, presenter, presented, queued, clock, state, advance, input };
}
