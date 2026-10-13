// Habit tracker service — local-only, persisted in SQLite.
const { randomUUID } = require('node:crypto');
const { tx } = require('../database/db');

function createHabitService({ db }) {
  const now = () => new Date().toISOString();
  const today = () => new Date().toISOString().slice(0, 10);

  function rowToHabit(row) {
    if (!row) return null;
    return {
      id: row.id, name: row.name, description: row.description,
      icon: row.icon, color: row.color, frequency: row.frequency,
      targetDays: JSON.parse(row.target_days || '[1,2,3,4,5,6,7]'),
      archived: row.archived === 1, sortOrder: row.sort_order,
      createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  function list({ includeArchived = false } = {}) {
    const rows = db.prepare(
      `SELECT * FROM habits WHERE archived <= ? ORDER BY sort_order, created_at`,
    ).all(includeArchived ? 1 : 0);
    return rows.map(rowToHabit);
  }

  function get(id) {
    const row = db.prepare('SELECT * FROM habits WHERE id = ?').get(id);
    if (!row) throw Object.assign(new Error('Habit not found'), { code: 'NOT_FOUND' });
    return rowToHabit(row);
  }

  function create(input) {
    const id = randomUUID();
    const n = now();
    tx(db, () => {
      db.prepare(
        `INSERT INTO habits (id, name, description, icon, color, frequency, target_days, archived, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      ).run(id, input.name.trim(), input.description || '', input.icon || '⭐', input.color || '#e8994a',
        input.frequency || 'daily', JSON.stringify(input.targetDays || [1,2,3,4,5,6,7]),
        input.sortOrder || 0, n, n);
    });
    return get(id);
  }

  function update(id, patch) {
    get(id); // throws if not found
    const fields = [];
    const vals = [];
    if (patch.name !== undefined)        { fields.push('name = ?');        vals.push(patch.name.trim()); }
    if (patch.description !== undefined) { fields.push('description = ?'); vals.push(patch.description); }
    if (patch.icon !== undefined)        { fields.push('icon = ?');        vals.push(patch.icon); }
    if (patch.color !== undefined)       { fields.push('color = ?');       vals.push(patch.color); }
    if (patch.frequency !== undefined)   { fields.push('frequency = ?');   vals.push(patch.frequency); }
    if (patch.targetDays !== undefined)  { fields.push('target_days = ?'); vals.push(JSON.stringify(patch.targetDays)); }
    if (patch.archived !== undefined)    { fields.push('archived = ?');    vals.push(patch.archived ? 1 : 0); }
    if (patch.sortOrder !== undefined)   { fields.push('sort_order = ?');  vals.push(patch.sortOrder); }
    if (!fields.length) return get(id);
    fields.push('updated_at = ?'); vals.push(now()); vals.push(id);
    db.prepare(`UPDATE habits SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
    return get(id);
  }

  function remove(id) {
    get(id);
    db.prepare('DELETE FROM habits WHERE id = ?').run(id);
    return true;
  }

  function complete(habitId, date = today(), note = '') {
    get(habitId);
    try {
      db.prepare(
        'INSERT INTO habit_completions (habit_id, date, note, created_at) VALUES (?, ?, ?, ?)'
      ).run(habitId, date, note, now());
    } catch {
      // Already completed that day — ignore unique violation
    }
    return getCompletions(habitId, date, date);
  }

  function uncomplete(habitId, date = today()) {
    db.prepare('DELETE FROM habit_completions WHERE habit_id = ? AND date = ?').run(habitId, date);
    return true;
  }

  // Returns completions for habit(s) in a date range [from, to] (YYYY-MM-DD).
  function getCompletions(habitId, from, to) {
    return db.prepare(
      'SELECT * FROM habit_completions WHERE habit_id = ? AND date >= ? AND date <= ? ORDER BY date'
    ).all(habitId, from, to);
  }

  // Returns all completions in range for all habits (used by frontend for weekly view).
  function rangeCompletions(from, to) {
    return db.prepare(
      'SELECT habit_id, date FROM habit_completions WHERE date >= ? AND date <= ?'
    ).all(from, to);
  }

  // Streak calculation: consecutive days (for daily habits).
  function streak(habitId) {
    const rows = db.prepare(
      'SELECT date FROM habit_completions WHERE habit_id = ? ORDER BY date DESC'
    ).all(habitId);
    if (!rows.length) return 0;
    let streak = 0;
    let expected = today();
    for (const row of rows) {
      if (row.date === expected) {
        streak++;
        const d = new Date(expected); d.setDate(d.getDate() - 1);
        expected = d.toISOString().slice(0, 10);
      } else if (row.date < expected) break;
    }
    return streak;
  }

  return { list, get, create, update, remove, complete, uncomplete, getCompletions, rangeCompletions, streak };
}

module.exports = { createHabitService };
