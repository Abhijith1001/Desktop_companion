// Deterministic task operations. Every write runs in a transaction that also
// records an outbox operation for cloud sync and an activity entry.
const crypto = require('crypto');
const { tx } = require('../database/db');
const { nextOccurrence, isRecurring, describe } = require('../scheduler/recurrence');

const COLS = {
  id: 'id', title: 'title', description: 'description', notes: 'notes', link: 'link', category: 'category',
  priority: 'priority', status: 'status', dueAt: 'due_at', timeZone: 'time_zone', recurrence: 'recurrence',
  leadMinutes: 'lead_minutes', nextOccurrenceAt: 'next_occurrence_at', createdAt: 'created_at',
  updatedAt: 'updated_at', completedAt: 'completed_at', deletedAt: 'deleted_at', version: 'version',
};

function toDto(row) {
  if (!row) return null;
  const dto = {};
  for (const [k, col] of Object.entries(COLS)) dto[k] = row[col];
  dto.recurrence = row.recurrence ? JSON.parse(row.recurrence) : null;
  dto.recurrenceText = describe(dto.recurrence);
  return dto;
}

// Row shape used by the recurrence engine.
const ruleView = (row) => ({
  due_at: row.due_at,
  time_zone: row.time_zone,
  recurrence: typeof row.recurrence === 'string' ? JSON.parse(row.recurrence) : row.recurrence,
});

const ms = (iso) => Date.parse(iso);
const iso = (t) => new Date(t).toISOString();

function createTaskService({ db, clock = () => new Date(), shouldSync = () => false, onChange = () => {} }) {
  const now = () => clock().toISOString();

  const getRow = (id) => db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  const mustGet = (id) => {
    const row = getRow(id);
    if (!row || row.deleted_at) {
      const err = new Error('Task not found');
      err.code = 'NOT_FOUND';
      throw err;
    }
    return row;
  };

  const logActivity = (type, taskId, meta) =>
    db.prepare('INSERT INTO activity (type, task_id, at, meta) VALUES (?, ?, ?, ?)')
      .run(type, taskId ?? null, now(), meta ? JSON.stringify(meta) : null);

  function enqueue(taskId, op) {
    if (!shouldSync()) return;
    const row = getRow(taskId);
    // Only the latest state matters, so drop older unsent upserts for this task.
    db.prepare("DELETE FROM outbox WHERE task_id = ? AND op = 'upsert'").run(taskId);
    db.prepare('INSERT INTO outbox (op_id, task_id, op, payload, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), taskId, op, JSON.stringify(toDto(row)), now());
  }

  // First reminder time for a newly created or edited task.
  function initialNext(rule) {
    if (!rule.due_at) return null;
    const t = now();
    if (!isRecurring(rule.recurrence)) return ms(rule.due_at) > ms(t) ? rule.due_at : null;
    const after = Math.max(ms(rule.due_at) - 1, ms(t) - 1);
    return nextOccurrence(rule, iso(after));
  }

  function writeTask(id, fields) {
    const sets = Object.keys(fields).map((c) => `${c} = ?`).join(', ');
    db.prepare(`UPDATE tasks SET ${sets} WHERE id = ?`).run(...Object.values(fields), id);
  }

  function create(input) {
    const id = crypto.randomUUID();
    const t = now();
    const rule = { due_at: input.dueAt, time_zone: input.timeZone, recurrence: input.recurrence };
    tx(db, () => {
      db.prepare(`INSERT INTO tasks (id, title, description, notes, link, category, priority, status, due_at, time_zone,
          recurrence, lead_minutes, next_occurrence_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, input.title, input.description, input.notes, input.link, input.category, input.priority,
          input.dueAt, input.timeZone, input.recurrence ? JSON.stringify(input.recurrence) : null,
          input.leadMinutes, initialNext(rule), t, t);
      logActivity('created', id);
      enqueue(id, 'upsert');
    });
    onChange();
    return get(id);
  }

  function update(id, input) {
    const row = mustGet(id);
    const rule = { due_at: input.dueAt, time_zone: input.timeZone, recurrence: input.recurrence };
    tx(db, () => {
      writeTask(id, {
        title: input.title, description: input.description, notes: input.notes, link: input.link,
        category: input.category, priority: input.priority, due_at: input.dueAt, time_zone: input.timeZone,
        recurrence: input.recurrence ? JSON.stringify(input.recurrence) : null, lead_minutes: input.leadMinutes,
        next_occurrence_at: row.status === 'PENDING' ? initialNext(rule) : null,
        updated_at: now(),
      });
      logActivity('updated', id);
      enqueue(id, 'upsert');
    });
    onChange();
    return get(id);
  }

  function remove(id) {
    mustGet(id);
    tx(db, () => {
      const t = now();
      writeTask(id, { deleted_at: t, updated_at: t, next_occurrence_at: null });
      db.prepare("UPDATE occurrences SET status = 'CANCELLED', resolved_at = ? WHERE task_id = ? AND status = 'PENDING'").run(t, id);
      logActivity('deleted', id);
      enqueue(id, 'delete');
    });
    onChange();
  }

  // Moves a task past its current occurrence. Recurring series advance to the
  // next occurrence after now (missed ones in between are skipped); one-off
  // tasks either complete or stop reminding.
  function advance(row, { complete }) {
    const t = now();
    const rule = ruleView(row);
    if (isRecurring(rule.recurrence)) {
      const from = Math.max(ms(row.next_occurrence_at || t), ms(t));
      const next = nextOccurrence(rule, iso(from));
      if (next) writeTask(row.id, { next_occurrence_at: next, updated_at: t });
      else writeTask(row.id, { status: 'COMPLETED', completed_at: t, next_occurrence_at: null, updated_at: t });
    } else if (complete) {
      writeTask(row.id, { status: 'COMPLETED', completed_at: t, next_occurrence_at: null, updated_at: t });
    } else {
      writeTask(row.id, { next_occurrence_at: null, updated_at: t });
    }
  }

  const getOcc = (occId) => db.prepare('SELECT * FROM occurrences WHERE id = ?').get(occId);

  // Resolves one reminder occurrence: COMPLETED, DISMISSED, EXPIRED or MISSED.
  function resolveOccurrence(occId, status) {
    return tx(db, () => {
      const occ = getOcc(occId);
      if (!occ || occ.status !== 'PENDING') return false;
      db.prepare('UPDATE occurrences SET status = ?, resolved_at = ? WHERE id = ?').run(status, now(), occId);
      const row = getRow(occ.task_id);
      if (row && !row.deleted_at && row.status === 'PENDING' && row.next_occurrence_at === occ.scheduled_at) {
        advance(row, { complete: status === 'COMPLETED' });
        enqueue(row.id, 'upsert');
      }
      logActivity(status.toLowerCase(), occ.task_id, { occurrence: occ.scheduled_at });
      onChange();
      return true;
    });
  }

  function snoozeOccurrence(occId, minutes) {
    const until = iso(ms(now()) + minutes * 60_000);
    const res = db.prepare("UPDATE occurrences SET snoozed_until = ? WHERE id = ? AND status = 'PENDING'").run(until, occId);
    if (res.changes) {
      const occ = getOcc(occId);
      logActivity('snoozed', occ.task_id, { minutes });
      onChange();
    }
    return until;
  }

  // Current occurrence for a task, creating one when a one-off task is overdue.
  function currentOccurrence(row) {
    let scheduled = row.next_occurrence_at;
    if (!scheduled) {
      scheduled = row.due_at || now();
      writeTask(row.id, { next_occurrence_at: scheduled });
    }
    const occId = `${row.id}@${scheduled}`;
    db.prepare(`INSERT OR IGNORE INTO occurrences (id, task_id, scheduled_at, remind_at) VALUES (?, ?, ?, ?)`)
      .run(occId, row.id, scheduled, iso(ms(scheduled) - row.lead_minutes * 60_000));
    return occId;
  }

  function complete(id) {
    const row = mustGet(id);
    if (row.status !== 'PENDING') return get(id);
    tx(db, () => {
      if (row.next_occurrence_at) {
        const occId = currentOccurrence(row);
        if (!resolveOccurrence(occId, 'COMPLETED')) advance(getRow(id), { complete: true });
      } else {
        advance(row, { complete: true });
        logActivity('completed', id);
      }
      enqueue(id, 'upsert');
    });
    onChange();
    return get(id);
  }

  function reopen(id) {
    const row = mustGet(id);
    tx(db, () => {
      const rule = ruleView(row);
      writeTask(id, { status: 'PENDING', completed_at: null, updated_at: now(), next_occurrence_at: null });
      writeTask(id, { next_occurrence_at: initialNext(rule) });
      logActivity('reopened', id);
      enqueue(id, 'upsert');
    });
    onChange();
    return get(id);
  }

  function snooze(id, minutes) {
    const row = mustGet(id);
    let until;
    tx(db, () => {
      const occId = currentOccurrence(row);
      until = snoozeOccurrence(occId, minutes);
      writeTask(id, { updated_at: now() });
      enqueue(id, 'upsert');
    });
    onChange();
    return until;
  }

  function list() {
    return db.prepare(`SELECT * FROM tasks WHERE deleted_at IS NULL
      ORDER BY CASE status WHEN 'PENDING' THEN 0 ELSE 1 END, COALESCE(next_occurrence_at, due_at, '9999'), created_at`)
      .all().map(toDto);
  }

  function get(id) {
    const dto = toDto(getRow(id));
    if (!dto) return null;
    dto.history = db.prepare(`SELECT scheduled_at AS scheduledAt, status, resolved_at AS resolvedAt, snoozed_until AS snoozedUntil
      FROM occurrences WHERE task_id = ? ORDER BY scheduled_at DESC LIMIT 20`).all(id);
    return dto;
  }

  // Applies a task received from the cloud (last-writer-wins on updatedAt;
  // local unsent edits win until they are pushed).
  function applyRemote(remote) {
    const pending = db.prepare('SELECT 1 FROM outbox WHERE task_id = ? LIMIT 1').get(remote.id);
    if (pending) return false;
    const local = getRow(remote.id);
    if (local && local.version >= remote.version && ms(local.updated_at) >= ms(remote.updatedAt)) return false;
    tx(db, () => {
      const fields = {
        title: remote.title, description: remote.description || '', notes: remote.notes || '', link: remote.link || '',
        category: remote.category || '', priority: remote.priority || 'MEDIUM', status: remote.status || 'PENDING',
        due_at: remote.dueAt || null, time_zone: remote.timeZone || 'UTC',
        recurrence: remote.recurrence ? JSON.stringify(remote.recurrence) : null, lead_minutes: remote.leadMinutes || 0,
        next_occurrence_at: remote.deletedAt ? null : remote.nextOccurrenceAt || null,
        created_at: remote.createdAt, updated_at: remote.updatedAt, completed_at: remote.completedAt || null,
        deleted_at: remote.deletedAt || null, version: remote.version,
      };
      if (local) writeTask(remote.id, fields);
      else {
        const cols = ['id', ...Object.keys(fields)];
        db.prepare(`INSERT INTO tasks (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
          .run(remote.id, ...Object.values(fields));
      }
      if (remote.deletedAt) {
        db.prepare("UPDATE occurrences SET status = 'CANCELLED', resolved_at = ? WHERE task_id = ? AND status = 'PENDING'").run(now(), remote.id);
      }
    });
    onChange();
    return true;
  }

  // Queues every local task for upload (used right after signing in).
  function enqueueAll() {
    tx(db, () => {
      for (const { id, deleted_at: del } of db.prepare('SELECT id, deleted_at FROM tasks').all()) enqueue(id, del ? 'delete' : 'upsert');
    });
  }

  function setVersion(id, version) {
    db.prepare('UPDATE tasks SET version = ? WHERE id = ? AND version < ?').run(version, id, version);
  }

  return {
    create, update, remove, complete, reopen, snooze, list, get, toDto,
    resolveOccurrence, snoozeOccurrence, applyRemote, enqueueAll, setVersion, logActivity,
  };
}

module.exports = { createTaskService, toDto };
