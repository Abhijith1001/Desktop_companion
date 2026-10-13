const { z } = require('zod');
const { IANAZone } = require('luxon');

const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'Invalid date');
const nullableIso = isoDate.nullable().optional().default(null);

const recurrence = z.object({
  type: z.enum(['none', 'daily', 'weekly', 'weekdays', 'every_n_days', 'every_n_weeks']),
  interval: z.number().int().min(1).max(365).optional(),
  weekdays: z.array(z.number().int().min(1).max(7)).max(7).optional(),
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
}).strip();

const taskPayload = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).default(''),
  notes: z.string().max(5000).default(''),
  link: z.string().max(2000).refine((s) => s === '' || /^https?:\/\//i.test(s), 'Invalid link').default(''),
  category: z.string().max(50).default(''),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM'),
  status: z.enum(['PENDING', 'COMPLETED', 'CANCELLED']).default('PENDING'),
  dueAt: nullableIso,
  timeZone: z.string().refine((zone) => IANAZone.isValidZone(zone), 'Unknown time zone'),
  recurrence: recurrence.nullable().optional().default(null),
  leadMinutes: z.number().int().min(0).max(1440).default(0),
  nextOccurrenceAt: nullableIso,
  createdAt: isoDate,
  updatedAt: isoDate,
  completedAt: nullableIso,
  deletedAt: nullableIso,
}).strip();

const syncOp = z.object({
  opId: z.string().uuid(),
  op: z.enum(['upsert', 'delete']),
  task: z.object({ id: z.string().uuid() }).passthrough(),
});

const schemas = {
  credentials: z.object({
    email: z.string().trim().toLowerCase().email().max(200),
    password: z.string().min(8).max(200),
  }),
  preferences: z.object({
    character: z.string().regex(/^[a-z0-9_-]{1,32}$/).optional(),
    theme: z.enum(['system', 'light', 'dark']).optional(),
    timeZone: z.string().refine((zone) => IANAZone.isValidZone(zone)).optional(),
  }).strict(),
  taskPayload,
  push: z.object({ ops: z.array(syncOp).max(100) }),
  changes: z.object({ since: z.string().max(100).optional(), limit: z.coerce.number().int().min(1).max(500).default(200) }),
  snooze: z.object({ minutes: z.number().int().min(1).max(1440) }),
  update: z.object({ task: z.object({}).passthrough(), expectedVersion: z.number().int().min(0).optional() }),
};

module.exports = { schemas };
