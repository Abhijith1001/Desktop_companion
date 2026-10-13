// Calendar importer for Google Calendar and Microsoft Outlook (.ics / iCalendar).
// Parses VEVENT records and converts them into companion tasks with meeting reminders.

const MEETING_URL_REGEX = /https?:\/\/(?:[a-zA-Z0-9-]+\.)?(?:zoom\.us|meet\.google\.com|teams\.microsoft\.com|webex\.com)[^\s"'>)]+/i;

/**
 * Unfold RFC 5545 folded lines.
 */
function unfoldIcs(raw) {
  return raw.replace(/\r\n[ \t]|\r[ \t]|\n[ \t]/g, '');
}

/**
 * Parse an iCalendar date string into an ISO string.
 * Formats:
 *   20261015T143000Z (UTC)
 *   20261015T143000 (Floating/Local)
 *   20261015 (All-day date)
 */
function parseIcsDate(val) {
  if (!val) return null;
  const clean = val.trim();
  // All day: YYYYMMDD
  if (/^\d{8}$/.test(clean)) {
    const y = clean.slice(0, 4);
    const m = clean.slice(4, 6);
    const d = clean.slice(6, 8);
    return `${y}-${m}-${d}T09:00:00.000Z`;
  }
  // DateTime: YYYYMMDDTHHMMSS or YYYYMMDDTHHMMSSZ
  const m = clean.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?/);
  if (m) {
    const [, y, mo, d, h, mi, s, z] = m;
    if (z) {
      return `${y}-${mo}-${d}T${h}:${mi}:${s}.000Z`;
    }
    // Assume UTC or local
    return `${y}-${mo}-${d}T${h}:${mi}:${s}.000Z`;
  }
  const parsed = Date.parse(clean);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

/**
 * Parse a basic recurrence rule from an RRULE line.
 */
function parseRRule(rruleStr) {
  if (!rruleStr) return null;
  const parts = Object.fromEntries(
    rruleStr.split(';').map((p) => {
      const [k, v] = p.split('=');
      return [k.toUpperCase(), v];
    })
  );

  const freq = parts.FREQ?.toUpperCase();
  if (!freq) return null;

  if (freq === 'DAILY') {
    const interval = parts.INTERVAL ? parseInt(parts.INTERVAL, 10) : 1;
    return interval > 1 ? { type: 'every_n_days', interval } : { type: 'daily' };
  }

  if (freq === 'WEEKLY') {
    const interval = parts.INTERVAL ? parseInt(parts.INTERVAL, 10) : 1;
    if (parts.BYDAY) {
      const days = parts.BYDAY.split(',');
      const LUXON_DAYS = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };
      const weekdays = days.map((d) => LUXON_DAYS[d.slice(-2)]).filter(Boolean);
      if (weekdays.length === 5 && [1, 2, 3, 4, 5].every((d) => weekdays.includes(d))) {
        return { type: 'weekdays', weekdays: [1, 2, 3, 4, 5] };
      }
      if (weekdays.length > 0) {
        return { type: 'weekdays', weekdays };
      }
    }
    return interval > 1 ? { type: 'every_n_weeks', interval } : { type: 'weekly' };
  }

  return null;
}

/**
 * Parse an iCalendar text into a list of normalized events.
 * @param {string} icsText
 * @returns {Array<{ uid: string, title: string, description: string, location: string, link: string, dueAt: string, recurrence: object|null }>}
 */
function parseIcs(icsText) {
  const unfolded = unfoldIcs(icsText || '');
  const lines = unfolded.split(/\r?\n/);
  const events = [];
  let inEvent = false;
  let cur = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === 'BEGIN:VEVENT') {
      inEvent = true;
      cur = { uid: '', summary: '', description: '', location: '', dtstart: '', rrule: '', url: '' };
      continue;
    }
    if (trimmed === 'END:VEVENT') {
      if (cur && cur.summary && cur.dtstart) {
        const dueAt = parseIcsDate(cur.dtstart);
        if (dueAt) {
          // Extract meeting link from location, description or url field
          let link = '';
          if (cur.url && /^https?:\/\//i.test(cur.url)) {
            link = cur.url;
          } else {
            const locMatch = cur.location.match(MEETING_URL_REGEX);
            const descMatch = cur.description.match(MEETING_URL_REGEX);
            link = locMatch ? locMatch[0] : (descMatch ? descMatch[0] : '');
          }

          events.push({
            uid: cur.uid || `event-${events.length + 1}`,
            title: cur.summary,
            description: cur.description,
            location: cur.location,
            link,
            dueAt,
            recurrence: parseRRule(cur.rrule),
          });
        }
      }
      inEvent = false;
      cur = null;
      continue;
    }

    if (!inEvent || !cur) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const keyPart = trimmed.slice(0, colonIdx);
    const val = trimmed.slice(colonIdx + 1);
    const key = keyPart.split(';')[0].toUpperCase();

    switch (key) {
      case 'UID':
        cur.uid = val.trim();
        break;
      case 'SUMMARY':
        cur.summary = val.replace(/\\n/g, ' ').replace(/\\,/g, ',').trim();
        break;
      case 'DESCRIPTION':
        cur.description = val.replace(/\\n/g, '\n').replace(/\\,/g, ',').trim();
        break;
      case 'LOCATION':
        cur.location = val.replace(/\\n/g, ' ').replace(/\\,/g, ',').trim();
        break;
      case 'DTSTART':
        cur.dtstart = val.trim();
        break;
      case 'RRULE':
        cur.rrule = val.trim();
        break;
      case 'URL':
        cur.url = val.trim();
        break;
      default:
        break;
    }
  }

  return events;
}

/**
 * Fetch calendar feed from a remote URL.
 * Supports webcal://, https://, and http://.
 */
async function fetchIcsFeed(feedUrl) {
  let url = (feedUrl || '').trim();
  if (url.startsWith('webcal://')) {
    url = `https://${url.slice(9)}`;
  }
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only HTTP or HTTPS calendar URLs are supported.');
  }

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'DesktopCompanion/2.1 (Calendar Importer)',
      Accept: 'text/calendar, text/plain, */*',
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    throw new Error(`Calendar feed returned HTTP status ${res.status}`);
  }

  return await res.text();
}

/**
 * Import parsed events into the companion's tasks database.
 */
function importCalendarEvents({ tasks, events, defaultLeadMinutes = 10, category = 'Meeting', timeZone = 'UTC' }) {
  const existingList = tasks.list();
  const existingByUid = new Set();
  const existingByTitleAndDue = new Set();

  for (const t of existingList) {
    if (t.notes) {
      const m = t.notes.match(/\[UID:\s*([^\]]+)\]/);
      if (m) existingByUid.add(m[1].trim());
    }
    if (t.dueAt) {
      existingByTitleAndDue.add(`${t.title.toLowerCase()}|||${t.dueAt}`);
    }
  }

  let imported = 0;
  let skipped = 0;

  for (const ev of events) {
    if (existingByUid.has(ev.uid) || existingByTitleAndDue.has(`${ev.title.toLowerCase()}|||${ev.dueAt}`)) {
      skipped++;
      continue;
    }

    const descParts = [];
    if (ev.location) descParts.push(`📍 ${ev.location}`);
    if (ev.description) descParts.push(ev.description);

    tasks.create({
      title: ev.title.slice(0, 200),
      description: descParts.join('\n\n').slice(0, 5000),
      notes: `Imported from calendar. [UID: ${ev.uid}]`,
      link: ev.link ? ev.link.slice(0, 2000) : '',
      category: category.slice(0, 50),
      priority: 'MEDIUM',
      dueAt: ev.dueAt,
      timeZone: timeZone || 'UTC',
      recurrence: ev.recurrence,
      leadMinutes: Math.min(Math.max(defaultLeadMinutes, 0), 120),
    });

    existingByUid.add(ev.uid);
    existingByTitleAndDue.add(`${ev.title.toLowerCase()}|||${ev.dueAt}`);
    imported++;
  }

  return { imported, skipped, total: events.length };
}

module.exports = {
  parseIcs,
  parseIcsDate,
  parseRRule,
  fetchIcsFeed,
  importCalendarEvents,
};
