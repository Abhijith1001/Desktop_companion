// Notepad notes. Local only (not synced).
const crypto = require('crypto');

function createNoteService({ db, clock = () => new Date(), onChange = () => {} }) {
  const now = () => clock().toISOString();
  const toDto = (r) => r && ({ id: r.id, title: r.title, body: r.body, createdAt: r.created_at, updatedAt: r.updated_at });

  const get = (id) => {
    const row = db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
    if (!row) { const err = new Error('Note not found'); err.code = 'NOT_FOUND'; throw err; }
    return toDto(row);
  };

  function list(q) {
    const like = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    const rows = like
      ? db.prepare("SELECT * FROM notes WHERE title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\' ORDER BY updated_at DESC").all(like, like)
      : db.prepare('SELECT * FROM notes ORDER BY updated_at DESC').all();
    return rows.map(toDto);
  }

  function create(input = {}) {
    const id = crypto.randomUUID();
    const at = now();
    db.prepare('INSERT INTO notes (id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, input.title ?? '', input.body ?? '', at, at);
    onChange();
    return get(id);
  }

  function update(id, patch) {
    const cur = get(id);
    db.prepare('UPDATE notes SET title = ?, body = ?, updated_at = ? WHERE id = ?')
      .run(patch.title ?? cur.title, patch.body ?? cur.body, now(), id);
    onChange();
    return get(id);
  }

  function remove(id) {
    get(id);
    db.prepare('DELETE FROM notes WHERE id = ?').run(id);
    onChange();
    return true;
  }

  const exportAll = () => list();

  return { list, get, create, update, remove, exportAll };
}

module.exports = { createNoteService };
