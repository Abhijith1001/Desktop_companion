// Conflict policy (documented in README):
//   • Last writer wins, comparing the device-side `updatedAt` of the whole task.
//   • Deletes are tombstones (`deletedAt`). A tombstone always wins over an
//     upsert whose updatedAt is not newer than the delete, so an old offline
//     copy cannot resurrect a deleted task.
//   • Every accepted write bumps `version` and `serverUpdatedAt` so other
//     devices pick it up from the change feed.
//   • Writes are optimistic: they only apply if the version read is still
//     current, retrying a few times under contention.
const { DateTime, IANAZone } = require('luxon');
const { Task, ProcessedOp } = require('../models');
const { schemas } = require('../validation');
const recurrence = require('../../../shared/recurrence')({ DateTime, IANAZone });

const dateOrNull = (v) => (v ? new Date(v) : null);
const isoOrNull = (d) => (d ? new Date(d).toISOString() : null);

function toClient(doc) {
  if (!doc) return null;
  return {
    id: doc._id,
    title: doc.title,
    description: doc.description,
    notes: doc.notes,
    link: doc.link,
    category: doc.category,
    priority: doc.priority,
    status: doc.status,
    dueAt: isoOrNull(doc.dueAt),
    timeZone: doc.timeZone,
    recurrence: doc.recurrence || null,
    leadMinutes: doc.leadMinutes,
    nextOccurrenceAt: isoOrNull(doc.nextOccurrenceAt),
    snoozedUntil: isoOrNull(doc.snoozedUntil),
    createdAt: isoOrNull(doc.createdAt),
    updatedAt: isoOrNull(doc.updatedAt),
    completedAt: isoOrNull(doc.completedAt),
    deletedAt: isoOrNull(doc.deletedAt),
    version: doc.version,
  };
}

class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

function fieldsFrom(payload) {
  return {
    title: payload.title,
    description: payload.description,
    notes: payload.notes,
    link: payload.link,
    category: payload.category,
    priority: payload.priority,
    status: payload.status,
    dueAt: dateOrNull(payload.dueAt),
    timeZone: payload.timeZone,
    recurrence: payload.recurrence,
    leadMinutes: payload.leadMinutes,
    nextOccurrenceAt: dateOrNull(payload.nextOccurrenceAt),
    createdAt: new Date(payload.createdAt),
    updatedAt: new Date(payload.updatedAt),
    completedAt: dateOrNull(payload.completedAt),
    deletedAt: dateOrNull(payload.deletedAt),
  };
}

// Optimistic compare-and-set on version.
async function writeIfUnchanged(existing, userId, id, set) {
  const now = new Date();
  if (!existing) {
    try {
      const doc = await Task.create({ _id: id, userId, ...set, version: 1, serverUpdatedAt: now });
      return doc.toObject();
    } catch (err) {
      if (err.code === 11000) return null; // created concurrently; caller retries
      throw err;
    }
  }
  return Task.findOneAndUpdate(
    { _id: id, userId, version: existing.version },
    { $set: { ...set, serverUpdatedAt: now }, $inc: { version: 1 } },
    { returnDocument: 'after', lean: true },
  );
}

/** Applies one upsert or delete. Returns { status, task?, error? }. */
async function applyChange(userId, op, rawTask) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const existing = await Task.findById(rawTask.id).lean();
    if (existing && String(existing.userId) !== String(userId)) return { status: 'rejected', error: 'Not found' };

    if (op === 'delete') {
      if (existing && existing.deletedAt) return { status: 'applied', task: toClient(existing) };
      const deletedAt = dateOrNull(rawTask.deletedAt) || new Date();
      const set = existing
        ? { deletedAt, updatedAt: deletedAt, nextOccurrenceAt: null }
        : { title: '', timeZone: 'UTC', createdAt: deletedAt, updatedAt: deletedAt, deletedAt };
      const doc = await writeIfUnchanged(existing, userId, rawTask.id, set);
      if (doc) return { status: 'applied', task: toClient(doc) };
      continue;
    }

    const parsed = schemas.taskPayload.safeParse(rawTask);
    if (!parsed.success) return { status: 'rejected', error: parsed.error.issues[0]?.message || 'Invalid task' };
    const incoming = fieldsFrom(parsed.data);

    if (existing && existing.deletedAt && existing.deletedAt >= incoming.updatedAt) {
      return { status: 'conflict', task: toClient(existing) };
    }
    if (existing && existing.updatedAt > incoming.updatedAt) {
      return { status: 'conflict', task: toClient(existing) };
    }
    const doc = await writeIfUnchanged(existing, userId, rawTask.id, incoming);
    if (doc) return { status: 'applied', task: toClient(doc) };
  }
  throw new HttpError(503, 'Too much contention, please retry');
}

/** Idempotent sync push: each opId is applied at most once per user. */
async function applyOps(userId, ops) {
  const results = [];
  for (const { opId, op, task } of ops) {
    const seen = await ProcessedOp.findOne({ userId, opId }).lean();
    if (seen) { results.push({ opId, ...seen.result, duplicate: true }); continue; }
    const result = await applyChange(userId, op, task);
    try {
      await ProcessedOp.create({ userId, opId, result });
    } catch (err) {
      if (err.code !== 11000) throw err; // a concurrent retry recorded it first
    }
    results.push({ opId, ...result });
  }
  return results;
}

// Change feed cursor = "<serverUpdatedAt ISO>|<task id>" so ties are never skipped.
async function changesSince(userId, since, limit) {
  const filter = { userId };
  if (since) {
    const [ts, id = ''] = since.split('|');
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) throw new HttpError(400, 'Invalid cursor');
    filter.$or = [{ serverUpdatedAt: { $gt: date } }, { serverUpdatedAt: date, _id: { $gt: id } }];
  }
  const docs = await Task.find(filter).sort({ serverUpdatedAt: 1, _id: 1 }).limit(limit + 1).lean();
  const page = docs.slice(0, limit);
  const last = page[page.length - 1];
  return {
    tasks: page.map(toClient),
    cursor: last ? `${last.serverUpdatedAt.toISOString()}|${last._id}` : since || null,
    hasMore: docs.length > limit,
  };
}

async function getOwned(userId, id) {
  const doc = await Task.findOne({ _id: id, userId, deletedAt: null }).lean();
  if (!doc) throw new HttpError(404, 'Task not found');
  return doc;
}

async function completeOccurrence(userId, id) {
  const doc = await getOwned(userId, id);
  const now = new Date();
  let set;
  if (recurrence.isRecurring(doc.recurrence)) {
    const from = new Date(Math.max(doc.nextOccurrenceAt ? doc.nextOccurrenceAt.getTime() : 0, now.getTime()));
    const next = recurrence.nextOccurrence({
      due_at: isoOrNull(doc.dueAt), time_zone: doc.timeZone, recurrence: doc.recurrence,
    }, from.toISOString());
    set = next ? { nextOccurrenceAt: new Date(next) } : { status: 'COMPLETED', completedAt: now, nextOccurrenceAt: null };
  } else {
    set = { status: 'COMPLETED', completedAt: now, nextOccurrenceAt: null };
  }
  const updated = await Task.findOneAndUpdate(
    { _id: id, userId, version: doc.version },
    { $set: { ...set, snoozedUntil: null, updatedAt: now, serverUpdatedAt: now }, $inc: { version: 1 } },
    { returnDocument: 'after', lean: true },
  );
  if (!updated) throw new HttpError(409, 'Task changed, please retry');
  return toClient(updated);
}

async function snooze(userId, id, minutes) {
  const doc = await getOwned(userId, id);
  const now = new Date();
  const updated = await Task.findOneAndUpdate(
    { _id: id, userId },
    { $set: { snoozedUntil: new Date(now.getTime() + minutes * 60_000), updatedAt: now, serverUpdatedAt: now }, $inc: { version: 1 } },
    { returnDocument: 'after', lean: true },
  );
  return toClient(updated || doc);
}

module.exports = { applyChange, applyOps, changesSince, getOwned, completeOccurrence, snooze, toClient, HttpError };
