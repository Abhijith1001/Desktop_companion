// Input validation for everything that crosses the IPC boundary.
const { z } = require('zod');
const { isValidZone } = require('../scheduler/recurrence');

const isoDateTime = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'Invalid date/time');
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
const safeUrl = z.string().max(2000).refine((s) => {
  if (s === '') return true;
  try { return ['http:', 'https:'].includes(new URL(s).protocol); } catch { return false; }
}, 'Links must start with http:// or https://');

const recurrenceSchema = z.object({
  type: z.enum(['none', 'daily', 'weekly', 'weekdays', 'every_n_days', 'every_n_weeks']),
  interval: z.number().int().min(1).max(365).optional(),
  weekdays: z.array(z.number().int().min(1).max(7)).max(7).optional(),
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
}).refine((r) => r.type !== 'weekdays' || (r.weekdays && r.weekdays.length > 0), 'Pick at least one weekday');

const taskInput = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  description: z.string().max(5000).default(''),
  notes: z.string().max(5000).default(''),
  link: safeUrl.default(''),
  category: z.string().trim().max(50).default(''),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM'),
  dueAt: isoDateTime.nullable().default(null),
  timeZone: z.string().refine(isValidZone, 'Unknown time zone'),
  recurrence: recurrenceSchema.nullable().default(null),
  leadMinutes: z.number().int().min(0).max(24 * 60).default(0),
}).refine((t) => !t.recurrence || t.recurrence.type === 'none' || t.dueAt, {
  message: 'Recurring tasks need a date and time', path: ['dueAt'],
});

const settingsPatch = z.object({
  character: z.string().regex(/^[a-z0-9_-]{1,32}$/),
  buddyName: z.string().trim().max(24),
  onboarded: z.boolean(),
  characterSize: z.number().min(0.75).max(1.5),
  animation: z.enum(['full', 'reduced', 'off']),
  personality: z.boolean(),
  sound: z.boolean(),
  volume: z.number().min(0).max(1),
  speech: z.boolean(),
  voice: z.string().max(200),
  notificationMode: z.enum(['buddy', 'buddy+system', 'system']),
  centerAnimation: z.boolean(),
  intensity: z.enum(['subtle', 'normal', 'strong']),
  alertTimeoutMinutes: z.number().int().min(1).max(240),
  quietHours: z.object({ enabled: z.boolean(), start: timeOfDay, end: timeOfDay }),
  defaultLeadMinutes: z.number().int().min(0).max(1440),
  defaultSnoozeMinutes: z.number().int().min(1).max(1440),
  missedPolicy: z.enum(['notify', 'skip']),
  breakEveryMin: z.number().int().min(0).max(480),
  timeZone: z.string().refine(isValidZone, 'Unknown time zone'),
  startWithWindows: z.boolean(),
  startHidden: z.boolean(),
  theme: z.enum(['system', 'light', 'dark']),
  accent: z.enum(['character', 'amber', 'rose', 'violet', 'sky', 'emerald']),
  chimeStyle: z.enum(['bells', 'marimba', 'soft', 'arcade', 'droplet']),
  progressSign: z.boolean(),
  crashReports: z.boolean(),
  updates: z.object({ mode: z.enum(['auto', 'ask']) }),
  followCursor: z.boolean(),
  perchOnWindows: z.boolean(),
  weather: z.object({
    enabled: z.boolean(),
    unit: z.enum(['C', 'F']),
    location: z.object({
      name: z.string().trim().min(1).max(120),
      lat: z.number().min(-90).max(90),
      lon: z.number().min(-180).max(180),
      country: z.string().max(80).optional(),
    }).strict().nullable(),
  }).partial().strict(),
  capture: z.lazy(() => captureSettings),
}).partial().strict();

const weatherQuery = z.string().trim().min(2, 'Type at least 2 letters').max(100);

const credentials = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
  serverUrl: z.string().url().refine((u) => {
    const url = new URL(u);
    return url.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(url.hostname);
  }, 'Server must use https:// (http is only allowed for localhost)'),
});

const id = z.string().uuid();
const rewardId = z.string().regex(/^[a-z0-9-]{1,32}$/);
const equipInput = z.object({ accessory: rewardId.nullable(), background: rewardId }).partial().strict();
const snoozeMinutes = z.number().int().min(1).max(1440);

// ---- Capture & bookmarks
const MAX_TEXT = 100_000;
const nullableText = (max) => z.string().trim().max(max).nullable().default(null).transform((s) => s || null);
const httpUrl = z.string().trim().max(2000).refine((s) => {
  try { return ['http:', 'https:'].includes(new URL(s).protocol); } catch { return false; }
}, 'Source URL must start with http:// or https://');
const tag = z.string().trim().min(1).max(40).regex(/^[^,<>]+$/, 'Tags cannot contain commas or < >');
const tagList = z.array(tag).max(20).transform((a) => [...new Set(a.map((t) => t.toLowerCase()))]);

const bookmarkInput = z.object({
  title: z.string().trim().min(1, 'Title is required').max(300),
  text: z.string().min(1, 'Text is required').max(MAX_TEXT, 'Text is too long (max 100,000 characters)')
    .refine((s) => s.trim().length > 0, 'Text is required'),
  sourceApp: nullableText(200),
  sourceTitle: nullableText(500),
  sourceUrl: httpUrl.nullable().default(null).or(z.literal('').transform(() => null)),
  captureMethod: z.enum(['uia', 'clipboard', 'ocr', 'drop', 'manual']).nullable().default(null),
  notes: z.string().max(10_000).default(''),
  tags: tagList.default([]),
  isFavorite: z.boolean().default(false),
}).strict();

const bookmarkPatch = z.object({
  title: z.string().trim().min(1, 'Title is required').max(300),
  text: z.string().min(1).max(MAX_TEXT).refine((s) => s.trim().length > 0, 'Text is required'),
  notes: z.string().max(10_000),
  tags: tagList, // no default: .partial() would otherwise wipe tags on unrelated edits
  sourceUrl: httpUrl.nullable().or(z.literal('').transform(() => null)),
  isFavorite: z.boolean(),
}).partial().strict();

const bookmarkFilter = z.object({
  q: z.string().max(200).optional(),
  app: z.string().max(200).optional(),
  tag: z.string().max(40).optional(),
  favorite: z.boolean().optional(),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).max(1_000_000).optional(),
}).strict().default({});

const droppedText = z.string().max(MAX_TEXT * 2);

// Electron accelerators: at least Ctrl or Alt plus one key. Combinations that
// would break everyday editing or Windows itself are refused.
const MODS = ['Control', 'Alt', 'Shift', 'Super'];
const KEY = /^([A-Z0-9]|F([1-9]|1[0-9]|2[0-4])|Space|Insert|Home|End|PageUp|PageDown|Up|Down|Left|Right|`|-|=|\[|\]|;|'|,|\.|\/|\\)$/;
const RESERVED = new Set(['Control+C', 'Control+V', 'Control+X', 'Control+Z', 'Control+Y', 'Control+A', 'Control+S', 'Control+F', 'Control+P', 'Control+W', 'Control+T', 'Control+N', 'Alt+F4', 'Alt+Tab', 'Control+Alt+B']);
const accelerator = z.string().max(60).refine((s) => {
  const parts = s.split('+');
  const key = parts.pop();
  if (!KEY.test(key || '') || new Set(parts).size !== parts.length) return false;
  if (!parts.every((p) => MODS.includes(p))) return false;
  return parts.includes('Control') || parts.includes('Alt');
}, 'Use Ctrl or Alt (optionally with Shift) plus a letter, number or F-key')
  .refine((s) => !RESERVED.has(s), 'That shortcut is reserved by Windows or Desktop Buddy');

const captureSettings = z.object({
  shortcut: accelerator,
  clipboardFallback: z.boolean(),
  ocrEnabled: z.boolean(),
  ocrShortcut: accelerator,
}).partial().strict()
  .refine((c) => !c.shortcut || !c.ocrShortcut || c.shortcut !== c.ocrShortcut, 'The two shortcuts must be different');

const chatMessage = z.object({ role: z.enum(['user', 'assistant']), text: z.string().min(1).max(20_000) }).strict();
const aiContext = z.object({
  kind: z.enum(['captured', 'bookmark']),
  title: z.string().max(300).optional(),
  text: z.string().min(1).max(MAX_TEXT),
  sourceApp: z.string().max(200).nullable().optional(),
  sourceUrl: z.string().max(2000).nullable().optional(),
  notes: z.string().max(10_000).optional(),
}).strict();
const aiRequest = z.object({
  history: z.array(chatMessage).min(1).max(40).refine((h) => h[h.length - 1].role === 'user', 'Last message must be from you'),
  context: z.array(aiContext).max(10).default([]),
  consent: z.literal(true, { message: 'Permission to send this message to the AI service is required' }),
}).strict();
const noteInput = z.object({ title: z.string().max(300), body: z.string().max(1_000_000, 'Note is too long') }).partial().strict();
const apiKey = z.string().trim().min(20, 'That does not look like an API key').max(300).regex(/^[A-Za-z0-9_-]+$/, 'That does not look like an API key');

// Throws an Error with a readable message instead of a ZodError dump.
function parse(schema, value) {
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  const issue = r.error.issues[0];
  const err = new Error(issue ? `${issue.path.join('.') || 'input'}: ${issue.message}` : 'Invalid input');
  err.code = 'VALIDATION';
  throw err;
}

const habitInput = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  description: z.string().max(500).default(''),
  icon: z.string().max(8).default('⭐'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Invalid hex color').default('#e8994a'),
  frequency: z.enum(['daily', 'weekly']).default('daily'),
  targetDays: z.array(z.number().int().min(0).max(7)).min(1).max(7).default([1,2,3,4,5,6,7]),
  sortOrder: z.number().int().min(0).default(0),
}).strict();

const habitPatch = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(500),
  icon: z.string().max(8),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  frequency: z.enum(['daily', 'weekly']),
  targetDays: z.array(z.number().int().min(0).max(7)).min(1).max(7),
  archived: z.boolean(),
  sortOrder: z.number().int().min(0),
}).partial().strict();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const feedbackInput = z.object({
  kind: z.enum(['idea', 'bug', 'love', 'other']),
  message: z.string().trim().min(3).max(4000),
  email: z.union([z.string().trim().email().max(200), z.literal('')]).default(''),
}).strict();
const errorReport = z.object({
  message: z.string().max(1000).default(''),
  stack: z.string().max(8000).default(''),
}).strip();

module.exports = {
  feedbackInput, errorReport,
  isoDateTime, taskInput, settingsPatch, credentials, id, snoozeMinutes, recurrenceSchema, parse, safeUrl,
  bookmarkInput, bookmarkPatch, bookmarkFilter, droppedText, accelerator, captureSettings, aiRequest, apiKey,
  noteInput, equipInput, weatherQuery, habitInput, habitPatch, isoDate,
};
