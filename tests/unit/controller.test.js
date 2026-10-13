import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { AnimationController, STATES } = require('../../electron/pet/controller');
const { line, reminderLine } = require('../../electron/dialogue');

function make() {
  const t = { now: 0 };
  const changes = [];
  const c = new AnimationController({ now: () => t.now, onChange: (s) => changes.push(s) });
  return { c, t, changes };
}

describe('animation controller', () => {
  it('idle → walking → idle', () => {
    const { c } = make();
    expect(c.transition(STATES.WALKING)).toBe(true);
    expect(c.isMoving).toBe(true);
    expect(c.transition(STATES.IDLE)).toBe(true);
  });

  it('task completed → celebrating → back to idle after its duration', () => {
    const { c, t } = make();
    c.transition(STATES.REMINDER);
    c.resolveReminder({ celebrate: true });
    expect(c.state).toBe(STATES.CELEBRATING);
    t.now += 1000; c.tick();
    expect(c.state).toBe(STATES.CELEBRATING);
    t.now += 2000; c.tick();
    expect(c.state).toBe(STATES.IDLE);
  });

  it('ambient behaviour cannot replace a reminder', () => {
    const { c } = make();
    c.transition(STATES.REMINDER);
    expect(c.transition(STATES.WALKING)).toBe(false);
    expect(c.transition(STATES.SITTING)).toBe(false);
    expect(c.pickAmbient(() => 0.1)).toBe(false);
    expect(c.state).toBe(STATES.REMINDER);
  });

  it('speaking during a reminder returns to the reminder', () => {
    const { c, t } = make();
    c.transition(STATES.REMINDER);
    c.transition(STATES.SPEAKING);
    t.now += 5000; c.tick();
    expect(c.state).toBe(STATES.REMINDER);
  });

  it('dragging interrupts and resumes the reminder on drop', () => {
    const { c } = make();
    c.transition(STATES.REMINDER);
    c.transition(STATES.DRAGGING);
    expect(c.transition(STATES.IDLE)).toBe(false);
    c.drop();
    expect(c.state).toBe(STATES.REMINDER);
  });

  it('sleeping is only left by wake, a reminder or a drag', () => {
    const { c } = make();
    c.sleep();
    expect(c.transition(STATES.WALKING)).toBe(false);
    expect(c.pickAmbient(() => 0.1)).toBe(false);
    expect(c.wake()).toBe(true);
    c.sleep();
    expect(c.transition(STATES.REMINDER)).toBe(true);
  });

  it('dropping a sleeping buddy keeps it asleep', () => {
    const { c } = make();
    c.sleep();
    c.transition(STATES.DRAGGING);
    c.drop();
    expect(c.state).toBe(STATES.SLEEPING);
  });

  it('rejects unknown states', () => {
    const { c } = make();
    expect(c.transition('FLYING')).toBe(false);
  });
});

describe('dialogue', () => {
  it('gives each character its own voice for the same event', () => {
    const lines = ['dog', 'tom', 'hero', 'ranger'].map((ch) => line(ch, 'overdue', { title: 'Report' }));
    expect(new Set(lines).size).toBe(4);
    expect(lines.every((l) => l.includes('Report'))).toBe(true);
  });

  it('uses plain reminders when personality is off', () => {
    expect(line('hero', 'reminder', { title: 'Call mom' }, { personality: false })).toBe('Reminder: Call mom');
  });

  it('picks upcoming/overdue variants', () => {
    expect(reminderLine('ranger', { title: 'Meeting', minutesUntil: 10 })).toMatch(/10 minutes/);
    expect(reminderLine('dog', { title: 'Report', overdue: true })).toMatch(/still have/);
  });
});
