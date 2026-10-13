import { describe, it, expect } from 'vitest';
import { makeStack } from './helpers.js';

const at = (iso) => iso;

describe('reminder engine', () => {
  it('delivers a reminder when due, exactly once', () => {
    const s = makeStack();
    s.tasks.create(s.input({ title: 'Call client', dueAt: at('2026-10-12T08:10:00.000Z') }));
    s.engine.tick();
    expect(s.presented).toHaveLength(0);

    s.advance(10);
    s.engine.tick();
    s.engine.tick();
    expect(s.presented).toHaveLength(1);
    expect(s.presented[0]).toMatchObject({ kind: 'task', title: 'Call client' });
  });

  it('honours lead time', () => {
    const s = makeStack();
    s.tasks.create(s.input({ dueAt: '2026-10-12T08:30:00.000Z', leadMinutes: 10 }));
    s.advance(19); s.engine.tick();
    expect(s.presented).toHaveLength(0);
    s.advance(1); s.engine.tick();
    expect(s.presented).toHaveLength(1);
    expect(s.presented[0].minutesUntil).toBe(10);
  });

  it('does not re-present a delivered reminder after restart', () => {
    const s = makeStack();
    s.tasks.create(s.input({ dueAt: '2026-10-12T08:05:00.000Z' }));
    s.advance(5); s.engine.tick();
    s.engine.ack(s.presented[0].deliveryId);

    // "restart": fresh presenter queue, same database
    s.queued.clear();
    s.advance(10); s.engine.tick();
    expect(s.presented).toHaveLength(1);
  });

  it('retries a claim that was never shown (crash recovery), then gives up', () => {
    const s = makeStack();
    s.tasks.create(s.input({ dueAt: '2026-10-12T08:01:00.000Z' }));
    s.advance(1); s.engine.tick();
    expect(s.presented).toHaveLength(1);

    s.queued.clear();                 // presenter lost it (crash)
    s.advance(1); s.engine.tick();    // not stale yet
    expect(s.presented).toHaveLength(1);
    s.advance(2); s.engine.tick();    // stale → retry #2
    expect(s.presented).toHaveLength(2);
    s.queued.clear(); s.advance(3); s.engine.tick(); // retry #3
    s.queued.clear(); s.advance(3); s.engine.tick(); // max attempts → FAILED
    expect(s.presented).toHaveLength(3);
    expect(s.db.prepare("SELECT state FROM deliveries").get().state).toBe('FAILED');
  });

  it('snooze re-delivers after the snooze period', () => {
    const s = makeStack();
    s.tasks.create(s.input({ dueAt: '2026-10-12T08:01:00.000Z' }));
    s.advance(1); s.engine.tick();
    const a = s.presented[0];
    s.engine.ack(a.deliveryId);
    s.engine.handleAction(a.occurrenceId, 'snooze', 5);
    s.advance(4); s.engine.tick();
    expect(s.presented).toHaveLength(1);
    s.advance(1); s.engine.tick();
    expect(s.presented).toHaveLength(2);
    expect(s.presented[1].occurrenceId).toBe(a.occurrenceId);
  });

  it('completing one recurring occurrence keeps the series going', () => {
    const s = makeStack();
    const t = s.tasks.create(s.input({ dueAt: '2026-10-12T08:01:00.000Z', recurrence: { type: 'daily' } }));
    s.advance(1); s.engine.tick();
    s.engine.handleAction(s.presented[0].occurrenceId, 'done');

    const after = s.tasks.get(t.id);
    expect(after.status).toBe('PENDING');
    expect(after.nextOccurrenceAt).toBe('2026-10-13T08:01:00.000Z');
    expect(after.history.find((h) => h.scheduledAt === '2026-10-12T08:01:00.000Z').status).toBe('COMPLETED');

    s.advance(24 * 60); s.engine.tick();
    expect(s.presented).toHaveLength(2);
  });

  it('completing a one-off reminder completes the task', () => {
    const s = makeStack();
    const t = s.tasks.create(s.input({ dueAt: '2026-10-12T08:01:00.000Z' }));
    s.advance(1); s.engine.tick();
    s.engine.handleAction(s.presented[0].occurrenceId, 'done');
    expect(s.tasks.get(t.id).status).toBe('COMPLETED');
  });

  it('notifies a single missed reminder after the app was closed', () => {
    const s = makeStack();
    s.tasks.create(s.input({ title: 'Missed one', dueAt: '2026-10-12T08:01:00.000Z' }));
    s.advance(180); // app was not running
    s.engine.tick();
    expect(s.presented).toHaveLength(1);
    expect(s.presented[0].overdue).toBe(true);
  });

  it('consolidates many missed reminders into one summary', () => {
    const s = makeStack();
    for (let i = 0; i < 4; i++) s.tasks.create(s.input({ title: `T${i}`, dueAt: `2026-10-12T08:0${i + 1}:00.000Z` }));
    s.advance(120);
    s.engine.tick();
    expect(s.presented).toHaveLength(1);
    expect(s.presented[0]).toMatchObject({ kind: 'missed-summary', count: 4 });
    s.engine.tick();
    expect(s.presented).toHaveLength(1);
  });

  it('skip policy resolves missed reminders silently', () => {
    const s = makeStack();
    s.settings.update({ missedPolicy: 'skip' });
    const t = s.tasks.create(s.input({ dueAt: '2026-10-12T08:01:00.000Z', recurrence: { type: 'daily' } }));
    s.advance(60);
    s.engine.tick();
    expect(s.presented).toHaveLength(0);
    expect(s.tasks.get(t.id).nextOccurrenceAt).toBe('2026-10-13T08:01:00.000Z');
  });

  it('a long absence does not create a backlog for recurring tasks', () => {
    const s = makeStack();
    const t = s.tasks.create(s.input({ dueAt: '2026-10-12T08:01:00.000Z', recurrence: { type: 'daily' } }));
    s.advance(5 * 24 * 60); // away for five days
    s.engine.tick();
    expect(s.presented).toHaveLength(1);
    s.engine.handleAction(s.presented[0].occurrenceId, 'dismiss');
    const next = s.tasks.get(t.id).nextOccurrenceAt;
    expect(Date.parse(next)).toBeGreaterThan(s.clock().getTime());
  });

  it('holds reminders during quiet hours', () => {
    const s = makeStack({ start: '2026-10-12T17:00:00.000Z' }); // 22:30 IST
    s.settings.update({ quietHours: { enabled: true, start: '22:00', end: '07:00' } });
    s.tasks.create(s.input({ dueAt: '2026-10-12T17:01:00.000Z' }));
    s.advance(1); s.engine.tick();
    expect(s.presented).toHaveLength(0);
    s.advance(9 * 60); s.engine.tick(); // 07:31 IST
    expect(s.presented).toHaveLength(1);
  });

  it('holds reminders while paused', () => {
    const s = makeStack();
    s.settings.update({ pausedUntil: '2026-10-12T09:00:00.000Z' });
    s.tasks.create(s.input({ dueAt: '2026-10-12T08:01:00.000Z' }));
    s.advance(2); s.engine.tick();
    expect(s.presented).toHaveLength(0);
    s.advance(60); s.engine.tick();
    expect(s.presented).toHaveLength(1);
  });

  it('editing a task reschedules its pending reminder', () => {
    const s = makeStack();
    const t = s.tasks.create(s.input({ dueAt: '2026-10-12T08:05:00.000Z' }));
    s.engine.tick();
    s.tasks.update(t.id, s.input({ dueAt: '2026-10-12T08:30:00.000Z' }));
    s.advance(10); s.engine.tick();
    expect(s.presented).toHaveLength(0);
    s.advance(20); s.engine.tick();
    expect(s.presented).toHaveLength(1);
  });

  it('a failing presenter does not block other reminders', () => {
    const s = makeStack();
    s.tasks.create(s.input({ title: 'bad', dueAt: '2026-10-12T08:01:00.000Z' }));
    s.tasks.create(s.input({ title: 'good', dueAt: '2026-10-12T08:01:00.000Z' }));
    const original = s.presenter.present;
    s.presenter.present = (a) => { if (a.title === 'bad') throw new Error('boom'); original(a); };
    s.advance(1);
    expect(() => s.engine.tick()).not.toThrow();
    expect(s.presented.map((p) => p.title)).toEqual(['good']);
  });

  it('deleted tasks never fire', () => {
    const s = makeStack();
    const t = s.tasks.create(s.input({ dueAt: '2026-10-12T08:01:00.000Z' }));
    s.engine.tick();
    s.tasks.remove(t.id);
    s.advance(5); s.engine.tick();
    expect(s.presented).toHaveLength(0);
  });
});
