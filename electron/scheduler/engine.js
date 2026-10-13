// Persistent reminder engine. Runs in the main process, independent of any window.
//
// Model
//   task.next_occurrence_at  → one materialised row in `occurrences`
//   occurrence fire time     = snoozed_until ?? remind_at (scheduled_at − lead time)
//   each fire time           → at most one row in `deliveries` (UNIQUE occurrence_id, fire_at)
//
// Delivery states: CLAIMED → DELIVERED (UI confirmed it was shown) | FAILED.
// A claim that is not confirmed within STALE_MS and is no longer queued in the
// presenter (e.g. after a crash) is retried, up to MAX_ATTEMPTS. This gives
// at-least-once presentation with duplicate suppression, not exactly-once.
//
// Missed-reminder policy (fire time more than MISSED_GRACE_MS in the past, e.g.
// after sleep or while the app was closed):
//   missedPolicy 'skip'   → resolved as MISSED without alerting
//   missedPolicy 'notify' → alerted; when MISSED_CONSOLIDATE_AT or more are missed
//                           at once they are consolidated into one summary alert
// Recurring tasks only ever materialise their next occurrence and advance past
// now when resolved, so a long absence never produces a backlog per task.
// Quiet hours and "pause reminders" hold delivery until they end.
const { tx } = require('../database/db');

const STALE_MS = 2 * 60_000;
const MAX_ATTEMPTS = 3;
const MISSED_GRACE_MS = 5 * 60_000;
const MISSED_CONSOLIDATE_AT = 3;
const MAX_SLEEP_MS = 60_000;

const ms = (iso) => Date.parse(iso);
const iso = (t) => new Date(t).toISOString();

function minutesOfDay(date, zone) {
  const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: zone })
    .formatToParts(date);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return get('hour') * 60 + get('minute');
}

function inQuietHours(quiet, date, zone) {
  if (!quiet || !quiet.enabled) return false;
  const toMin = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const start = toMin(quiet.start);
  const end = toMin(quiet.end);
  const cur = minutesOfDay(date, zone);
  return start <= end ? cur >= start && cur < end : cur >= start || cur < end;
}

function createEngine({ db, tasks, settings, presenter, log, clock = () => new Date(), setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer = null;
  let running = false;

  const now = () => clock();

  // Keeps exactly one PENDING occurrence per pending task, matching its
  // current next_occurrence_at and lead time.
  function materialize() {
    tx(db, () => {
      db.prepare(`UPDATE occurrences SET status = 'SUPERSEDED', resolved_at = ?
        WHERE status = 'PENDING' AND NOT EXISTS (
          SELECT 1 FROM tasks t WHERE t.id = occurrences.task_id AND t.status = 'PENDING'
            AND t.deleted_at IS NULL AND t.next_occurrence_at = occurrences.scheduled_at)`).run(now().toISOString());
      const rows = db.prepare(`SELECT id, next_occurrence_at, lead_minutes FROM tasks
        WHERE status = 'PENDING' AND deleted_at IS NULL AND next_occurrence_at IS NOT NULL`).all();
      const upsert = db.prepare(`INSERT INTO occurrences (id, task_id, scheduled_at, remind_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET remind_at = excluded.remind_at,
          status = CASE WHEN occurrences.status = 'SUPERSEDED' THEN 'PENDING' ELSE occurrences.status END,
          resolved_at = CASE WHEN occurrences.status = 'SUPERSEDED' THEN NULL ELSE occurrences.resolved_at END`);
      for (const r of rows) {
        upsert.run(`${r.id}@${r.next_occurrence_at}`, r.id, r.next_occurrence_at, iso(ms(r.next_occurrence_at) - r.lead_minutes * 60_000));
      }
    });
  }

  function dueOccurrences(nowIso) {
    return db.prepare(`SELECT o.id, o.task_id, o.scheduled_at, COALESCE(o.snoozed_until, o.remind_at) AS fire_at,
        t.title, t.description, t.link, t.priority, t.recurrence
      FROM occurrences o JOIN tasks t ON t.id = o.task_id
      WHERE o.status = 'PENDING' AND COALESCE(o.snoozed_until, o.remind_at) <= ?
      ORDER BY fire_at`).all(nowIso);
  }

  // Returns a delivery id when this caller owns presenting (occurrence, fireAt).
  function claim(occ) {
    return tx(db, () => {
      const t = now().toISOString();
      const ins = db.prepare(`INSERT INTO deliveries (occurrence_id, fire_at, state, attempts, claimed_at)
        VALUES (?, ?, 'CLAIMED', 1, ?) ON CONFLICT(occurrence_id, fire_at) DO NOTHING`).run(occ.id, occ.fire_at, t);
      if (ins.changes) return Number(ins.lastInsertRowid);

      const d = db.prepare('SELECT * FROM deliveries WHERE occurrence_id = ? AND fire_at = ?').get(occ.id, occ.fire_at);
      if (d.state !== 'CLAIMED') return null;                       // DELIVERED or FAILED: never re-present
      if (presenter.isQueued(d.id)) return null;                     // waiting its turn on screen
      if (ms(t) - ms(d.claimed_at) < STALE_MS) return null;          // in flight
      if (d.attempts >= MAX_ATTEMPTS) {
        db.prepare("UPDATE deliveries SET state = 'FAILED', error = COALESCE(error, 'max attempts') WHERE id = ?").run(d.id);
        log.warn('reminder delivery failed', { occurrence: occ.id, attempts: d.attempts });
        return null;
      }
      db.prepare('UPDATE deliveries SET attempts = attempts + 1, claimed_at = ? WHERE id = ?').run(t, d.id);
      log.info('retrying stale reminder claim', { occurrence: occ.id, attempt: d.attempts + 1 });
      return d.id;
    });
  }

  function heldUntil(date) {
    const s = settings.getAll();
    if (s.pausedUntil && ms(s.pausedUntil) > date.getTime()) return { reason: 'paused', until: ms(s.pausedUntil) };
    if (inQuietHours(s.quietHours, date, s.timeZone)) return { reason: 'quiet', until: null };
    return null;
  }

  function nextWakeDelay(nowMs) {
    const row = db.prepare(`SELECT MIN(COALESCE(snoozed_until, remind_at)) AS next FROM occurrences
      WHERE status = 'PENDING' AND COALESCE(snoozed_until, remind_at) > ?`).get(iso(nowMs));
    const next = row && row.next ? ms(row.next) - nowMs : MAX_SLEEP_MS;
    // Re-check at least every minute so clock changes and stale claims are noticed.
    return Math.max(250, Math.min(next, MAX_SLEEP_MS));
  }

  function tick() {
    const date = now();
    const nowMs = date.getTime();
    try {
      materialize();
      const hold = heldUntil(date);
      if (!hold) {
        const due = dueOccurrences(date.toISOString());
        const policy = settings.get('missedPolicy');
        const missed = due.filter((o) => nowMs - ms(o.fire_at) > MISSED_GRACE_MS);
        const fresh = due.filter((o) => nowMs - ms(o.fire_at) <= MISSED_GRACE_MS);

        if (policy === 'skip') {
          for (const o of missed) safe(o, () => tasks.resolveOccurrence(o.id, 'MISSED'));
        } else if (missed.length >= MISSED_CONSOLIDATE_AT) {
          const claimed = missed.map((o) => ({ o, id: claim(o) })).filter((x) => x.id);
          if (claimed.length) {
            for (const { o, id } of claimed) {
              tasks.resolveOccurrence(o.id, 'MISSED');
              db.prepare("UPDATE deliveries SET state = 'DELIVERED', delivered_at = ? WHERE id = ?").run(date.toISOString(), id);
            }
            presenter.present({ kind: 'missed-summary', titles: claimed.map((x) => x.o.title), count: claimed.length });
          }
        } else {
          fresh.unshift(...missed.map((o) => ({ ...o, missed: true })));
        }
        for (const o of fresh) safe(o, () => present(o, nowMs));
      }
    } catch (err) {
      log.error('reminder tick failed', { error: err.message, stack: err.stack });
    }
    schedule(nextWakeDelay(nowMs));
  }

  // One failing reminder must never stop the others.
  function safe(o, fn) {
    try { fn(); } catch (err) {
      log.error('reminder failed', { occurrence: o.id, error: err.message });
      try {
        db.prepare("UPDATE deliveries SET error = ? WHERE occurrence_id = ? AND fire_at = ? AND state = 'CLAIMED'")
          .run(err.message.slice(0, 500), o.id, o.fire_at);
      } catch { /* ignore */ }
    }
  }

  function present(o, nowMs) {
    const deliveryId = claim(o);
    if (!deliveryId) return;
    presenter.present({
      kind: 'task',
      deliveryId,
      occurrenceId: o.id,
      taskId: o.task_id,
      title: o.title,
      description: o.description,
      link: o.link,
      priority: o.priority,
      scheduledAt: o.scheduled_at,
      overdue: ms(o.scheduled_at) < nowMs - MISSED_GRACE_MS,
      minutesUntil: Math.max(0, Math.round((ms(o.scheduled_at) - nowMs) / 60_000)),
      recurring: !!o.recurrence && JSON.parse(o.recurrence).type !== 'none',
    });
  }

  function schedule(delay) {
    if (!running) return;
    if (timer) clearTimer(timer);
    timer = setTimer(tick, delay);
  }

  // Called by the presenter once the reminder is visible to the user.
  function ack(deliveryId) {
    db.prepare("UPDATE deliveries SET state = 'DELIVERED', delivered_at = ? WHERE id = ? AND state = 'CLAIMED'")
      .run(now().toISOString(), deliveryId);
  }

  function fail(deliveryId, error) {
    db.prepare("UPDATE deliveries SET error = ? WHERE id = ?").run(String(error).slice(0, 500), deliveryId);
  }

  // User response to a reminder.
  function handleAction(occurrenceId, action, minutes) {
    switch (action) {
      case 'done': tasks.resolveOccurrence(occurrenceId, 'COMPLETED'); break;
      case 'dismiss': tasks.resolveOccurrence(occurrenceId, 'DISMISSED'); break;
      case 'expire': tasks.resolveOccurrence(occurrenceId, 'EXPIRED'); break;
      case 'snooze': tasks.snoozeOccurrence(occurrenceId, minutes || settings.get('defaultSnoozeMinutes')); break;
      default: throw new Error(`Unknown action ${action}`);
    }
    wake();
  }

  function wake() { schedule(0); }

  function start() {
    running = true;
    log.info('reminder engine started');
    wake();
  }

  function stop() {
    running = false;
    if (timer) clearTimer(timer);
    timer = null;
  }

  function stats() {
    return {
      pending: db.prepare("SELECT COUNT(*) AS c FROM occurrences WHERE status = 'PENDING'").get().c,
      failed: db.prepare("SELECT COUNT(*) AS c FROM deliveries WHERE state = 'FAILED'").get().c,
      next: db.prepare("SELECT MIN(COALESCE(snoozed_until, remind_at)) AS n FROM occurrences WHERE status = 'PENDING'").get().n,
    };
  }

  return { start, stop, wake, tick, ack, fail, handleAction, materialize, stats, heldUntil };
}

module.exports = { createEngine, inQuietHours, STALE_MS, MAX_ATTEMPTS, MISSED_GRACE_MS, MISSED_CONSOLIDATE_AT };
