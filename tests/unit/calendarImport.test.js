import { describe, it, expect } from 'vitest';
import { parseIcs, parseIcsDate, parseRRule, importCalendarEvents } from '../../electron/services/calendarImport.js';

describe('calendarImport', () => {
  describe('parseIcsDate', () => {
    it('parses UTC date-time string', () => {
      const iso = parseIcsDate('20261015T143000Z');
      expect(iso).toBe('2026-10-15T14:30:00.000Z');
    });

    it('parses all-day date string', () => {
      const iso = parseIcsDate('20261015');
      expect(iso).toBe('2026-10-15T09:00:00.000Z');
    });
  });

  describe('parseRRule', () => {
    it('parses daily recurrence', () => {
      expect(parseRRule('FREQ=DAILY')).toEqual({ type: 'daily' });
      expect(parseRRule('FREQ=DAILY;INTERVAL=2')).toEqual({ type: 'every_n_days', interval: 2 });
    });

    it('parses weekly weekdays recurrence', () => {
      const rule = parseRRule('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
      expect(rule).toEqual({ type: 'weekdays', weekdays: [1, 2, 3, 4, 5] });
    });
  });

  describe('parseIcs with Google Calendar sample', () => {
    const sample = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Google Inc//Google Calendar 70.9054//EN
BEGIN:VEVENT
UID:google-event-123@google.com
SUMMARY:Team Sprint Planning
DESCRIPTION:Discuss quarterly goals.\\nBring notes.
LOCATION:https://meet.google.com/abc-defg-hij
DTSTART:20261018T150000Z
DTEND:20261018T160000Z
END:VEVENT
BEGIN:VEVENT
UID:outlook-event-456@outlook.com
SUMMARY:Doctor Checkup
DESCRIPTION:Bring insurance card
LOCATION:Room 402
DTSTART:20261019T103000Z
DTEND:20261019T113000Z
RRULE:FREQ=WEEKLY;BYDAY=MO
END:VEVENT
END:VCALENDAR`;

    it('parses Google Calendar and Outlook events and meeting links', () => {
      const events = parseIcs(sample);
      expect(events).toHaveLength(2);

      const sprint = events[0];
      expect(sprint.title).toBe('Team Sprint Planning');
      expect(sprint.link).toBe('https://meet.google.com/abc-defg-hij');
      expect(sprint.dueAt).toBe('2026-10-18T15:00:00.000Z');

      const doc = events[1];
      expect(doc.title).toBe('Doctor Checkup');
      expect(doc.location).toBe('Room 402');
      expect(doc.recurrence).toEqual({ type: 'weekdays', weekdays: [1] });
    });
  });

  describe('importCalendarEvents', () => {
    it('creates tasks and avoids duplicate imports', () => {
      const created = [];
      const mockTasks = {
        list: () => created,
        create: (item) => {
          const t = { id: `task-${created.length}`, ...item };
          created.push(t);
          return t;
        },
      };

      const events = [
        {
          uid: 'uid-1',
          title: 'Design Review',
          description: 'Review new components',
          location: 'https://meet.google.com/xyz',
          link: 'https://meet.google.com/xyz',
          dueAt: '2026-10-20T14:00:00.000Z',
          recurrence: null,
        },
      ];

      const res1 = importCalendarEvents({
        tasks: mockTasks,
        events,
        defaultLeadMinutes: 10,
        category: 'Meeting',
        timeZone: 'UTC',
      });

      expect(res1.imported).toBe(1);
      expect(res1.skipped).toBe(0);
      expect(created[0].title).toBe('Design Review');
      expect(created[0].category).toBe('Meeting');
      expect(created[0].leadMinutes).toBe(10);
      expect(created[0].notes).toContain('uid-1');

      // Re-importing same event should skip
      const res2 = importCalendarEvents({
        tasks: mockTasks,
        events,
        defaultLeadMinutes: 10,
        category: 'Meeting',
        timeZone: 'UTC',
      });

      expect(res2.imported).toBe(0);
      expect(res2.skipped).toBe(1);
      expect(created).toHaveLength(1);
    });
  });
});
