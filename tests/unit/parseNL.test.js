import { describe, it, expect } from 'vitest';
import { parseNL } from '../../src/utils/parseNL.js';

describe('parseNL natural language parser', () => {
  it('parses "call mom tomorrow 6pm every week"', () => {
    const res = parseNL('call mom tomorrow 6pm every week');
    expect(res.title.toLowerCase()).toBe('call mom');
    expect(res.time).toBe('18:00');
    expect(res.date).not.toBeNull();
    expect(res.recurrence).toEqual({ type: 'weekly' });
  });

  it('parses daily recurrence', () => {
    const res = parseNL('exercise at 7am daily');
    expect(res.title.toLowerCase()).toBe('exercise');
    expect(res.time).toBe('07:00');
    expect(res.recurrence).toEqual({ type: 'daily' });
  });

  it('parses weekday recurrence with 1-7 ISO weekdays', () => {
    const res = parseNL('team standup at 9:30am on weekdays');
    expect(res.title.toLowerCase()).toBe('team standup');
    expect(res.time).toBe('09:30');
    expect(res.recurrence).toEqual({ type: 'weekdays', weekdays: [1, 2, 3, 4, 5] });
  });

  it('parses specific day recurrence like every sunday', () => {
    const res = parseNL('call grandparents 5pm every sunday');
    expect(res.title.toLowerCase()).toBe('call grandparents');
    expect(res.time).toBe('17:00');
    expect(res.recurrence).toEqual({ type: 'weekdays', weekdays: [7] });
  });

  it('parses explicit month and day', () => {
    const res = parseNL('Dentist appointment Oct 25 at 2pm');
    expect(res.title.toLowerCase()).toBe('dentist appointment');
    expect(res.time).toBe('14:00');
    expect(res.date).toContain('-10-25');
  });
});
