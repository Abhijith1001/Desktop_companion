/**
 * Natural-language task parser.
 * Extracts date, time, and recurrence from a free-text string.
 * Returns { title, date, time, recurrence } where date is YYYY-MM-DD and time is HH:MM.
 */

const TODAY = () => new Date();

// ---- Relative-day patterns -----------------------------------------------
const REL_DAY = [
  { re: /\btoday\b/i,                   offset: 0 },
  { re: /\btomorrow\b/i,                offset: 1 },
  { re: /\bday after tomorrow\b/i,      offset: 2 },
  { re: /\bin (\d+) days?\b/i,          offsetFn: (m) => parseInt(m[1]) },
  { re: /\bnext week\b/i,               offset: 7 },
  { re: /\bnext month\b/i,              monthOffset: 1 },
];

const WEEKDAY_NAMES = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];

// "next monday", "this friday", "on thursday"
const WEEKDAY_RE = /\b(?:next|this|on)?\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;

// ---- Time patterns -------------------------------------------------------
const TIME_PATTERNS = [
  { re: /(?:\bat\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i, fn: (m) => {
    let h = parseInt(m[1]);
    const min = m[2] ? parseInt(m[2]) : 0;
    const ampm = m[3].toLowerCase();
    if (ampm === 'pm' && h !== 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    return { h, min };
  }},
  { re: /\bat\s+(\d{1,2})(?::(\d{2}))?\b/i, fn: (m) => ({
    h: parseInt(m[1]), min: m[2] ? parseInt(m[2]) : 0,
  })},
  { re: /(?:\bat\s+)?(noon|midday)\b/i, fn: () => ({ h: 12, min: 0 }) },
  { re: /(?:\bat\s+)?midnight\b/i,      fn: () => ({ h: 0, min: 0 }) },
  { re: /(?:\bin\s+the\s+)?morning\b/i,       fn: () => ({ h: 9, min: 0 }) },
  { re: /(?:\bin\s+the\s+)?afternoon\b/i,     fn: () => ({ h: 14, min: 0 }) },
  { re: /(?:\bin\s+the\s+)?evening\b/i,       fn: () => ({ h: 18, min: 0 }) },
  { re: /(?:\bat\s+)?night\b/i,         fn: () => ({ h: 20, min: 0 }) },
];

const LUXON_WEEKDAY = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7 };

// ---- Recurrence patterns -------------------------------------------------
const RECURRENCE_PATTERNS = [
  { re: /\bevery\s+day\b|\bdaily\b/i,          type: 'daily' },
  { re: /\bevery\s+week\b|\bweekly\b/i,        type: 'weekly' },
  { re: /\bevery\s+(\d+)\s+days?\b/i,          type: 'every_n_days', intervalFn: (m) => parseInt(m[1]) },
  { re: /\bevery\s+(\d+)\s+weeks?\b/i,         type: 'every_n_weeks', intervalFn: (m) => parseInt(m[1]) },
  { re: /\bevery\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
    type: 'weekdays', weekdayFn: (m) => [LUXON_WEEKDAY[m[1].toLowerCase()]] },
  { re: /(?:\bon\s+)?(?:weekdays?|mon[–\-]fri)\b/i,      type: 'weekdays', weekdays: [1,2,3,4,5] },
  { re: /(?:\bon\s+)?weekends?\b/i,                      type: 'weekdays', weekdays: [6,7] },
];

// ---- Date from explicit "Month Day" patterns
const MONTH_NAMES = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const MONTH_SHORT = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const MONTH_RE = new RegExp(
  `\\b(${MONTH_NAMES.map((n,i) => n+'|'+MONTH_SHORT[i]).join('|')})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i'
);
const DAY_MONTH_RE = new RegExp(
  `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_NAMES.map((n,i) => n+'|'+MONTH_SHORT[i]).join('|')})\\b`, 'i'
);

function dateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function timeStr(h, min) {
  return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
}

function resolveMonth(str) {
  const s = str.toLowerCase();
  let idx = MONTH_NAMES.indexOf(s);
  if (idx === -1) idx = MONTH_SHORT.indexOf(s);
  return idx;
}

function stripTokens(text, regexes) {
  let s = text;
  for (const r of regexes) s = s.replace(r, ' ');
  // Clean dangling prepositions at the end or standalone between tokens
  s = s.replace(/\b(?:at|on|in|by|for)\s*$/i, '');
  s = s.replace(/^\s*\b(?:at|on|in|by|for)\b/i, '');
  s = s.replace(/\s+\b(?:at|on|in|by|for)\s+/gi, ' ');
  return s.replace(/\s{2,}/g, ' ').trim().replace(/^[-,\s]+|[-,\s]+$/g, '');
}

/**
 * Parse a natural language string into structured task fields.
 * @param {string} raw
 * @returns {{ title: string, date: string|null, time: string|null, recurrence: object|null }}
 */
export function parseNL(raw) {
  const text = raw.trim();
  if (!text) return { title: '', date: null, time: null, recurrence: null };

  const strippedTokens = [];

  // ---- Extract recurrence
  let recurrence = null;
  for (const p of RECURRENCE_PATTERNS) {
    const m = text.match(p.re);
    if (m) {
      recurrence = { type: p.type };
      if (p.intervalFn) recurrence.interval = p.intervalFn(m);
      if (p.weekdays) recurrence.weekdays = p.weekdays;
      if (p.weekdayFn) recurrence.weekdays = p.weekdayFn(m);
      strippedTokens.push(p.re);
      break;
    }
  }

  // ---- Extract time
  let timeParsed = null;
  for (const p of TIME_PATTERNS) {
    const m = text.match(p.re);
    if (m) {
      timeParsed = p.fn(m);
      strippedTokens.push(p.re);
      break;
    }
  }

  // ---- Extract date
  let dateParsed = null;
  const now = TODAY();

  // Try "Month Day" or "Day Month"
  const mMonth = text.match(MONTH_RE);
  const mDayMonth = text.match(DAY_MONTH_RE);
  if (mMonth) {
    const month = resolveMonth(mMonth[1]);
    const day = parseInt(mMonth[2]);
    if (month !== -1) {
      const d = new Date(now.getFullYear(), month, day);
      if (d < now) d.setFullYear(d.getFullYear() + 1);
      dateParsed = d;
      strippedTokens.push(MONTH_RE);
    }
  } else if (mDayMonth) {
    const month = resolveMonth(mDayMonth[2]);
    const day = parseInt(mDayMonth[1]);
    if (month !== -1) {
      const d = new Date(now.getFullYear(), month, day);
      if (d < now) d.setFullYear(d.getFullYear() + 1);
      dateParsed = d;
      strippedTokens.push(DAY_MONTH_RE);
    }
  }

  if (!dateParsed) {
    // Try relative day
    for (const p of REL_DAY) {
      const m = text.match(p.re);
      if (m) {
        const d = new Date(now);
        if (p.offset !== undefined) d.setDate(d.getDate() + p.offset);
        else if (p.offsetFn) d.setDate(d.getDate() + p.offsetFn(m));
        else if (p.monthOffset) d.setMonth(d.getMonth() + p.monthOffset);
        dateParsed = d;
        strippedTokens.push(p.re);
        break;
      }
    }
    // Try weekday name
    if (!dateParsed) {
      const mWD = text.match(WEEKDAY_RE);
      if (mWD) {
        const targetDay = WEEKDAY_NAMES.indexOf(mWD[1].toLowerCase());
        const d = new Date(now);
        let diff = targetDay - d.getDay();
        if (diff <= 0) diff += 7;
        d.setDate(d.getDate() + diff);
        dateParsed = d;
        strippedTokens.push(WEEKDAY_RE);
      }
    }
  }

  // If we have a time but no explicit date, pick today (or tomorrow if already past)
  if (timeParsed && !dateParsed) {
    const d = new Date(now);
    const candidate = new Date(d.getFullYear(), d.getMonth(), d.getDate(), timeParsed.h, timeParsed.min);
    if (candidate <= now) d.setDate(d.getDate() + 1);
    dateParsed = d;
  }

  const title = stripTokens(text, strippedTokens);

  return {
    title: title || text,
    date: dateParsed ? dateStr(dateParsed) : null,
    time: timeParsed ? timeStr(timeParsed.h, timeParsed.min) : null,
    recurrence,
  };
}
