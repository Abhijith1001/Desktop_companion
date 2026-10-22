// Projects: each has its own checklist, notes and attached files. Local only
// (not synced). Attached files are copied into <filesDir>/<projectId>/ so the
// project keeps working if the original is moved or deleted.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MAX_FILE_BYTES = 500 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 8 * 1024 * 1024;

const KINDS = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'],
  video: ['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v'],
  audio: ['mp3', 'wav', 'ogg', 'm4a', 'flac'],
  pdf: ['pdf'],
  doc: ['doc', 'docx', 'odt', 'rtf', 'txt', 'md', 'xls', 'xlsx', 'csv', 'ppt', 'pptx'],
};
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml' };

const extOf = (name) => path.extname(name).slice(1).toLowerCase();
const kindOf = (name) => Object.keys(KINDS).find((k) => KINDS[k].includes(extOf(name))) || 'other';

function notFound(what) { const err = new Error(`${what} not found`); err.code = 'NOT_FOUND'; return err; }

function createProjectService({ db, filesDir, clock = () => new Date(), onChange = () => {} }) {
  const now = () => clock().toISOString();

  const projectDto = (r) => r && ({
    id: r.id, name: r.name, description: r.description, color: r.color, status: r.status,
    createdAt: r.created_at, updatedAt: r.updated_at,
    counts: { tasks: r.task_count ?? 0, done: r.done_count ?? 0, notes: r.note_count ?? 0, files: r.file_count ?? 0 },
  });
  const taskDto = (r) => ({ id: r.id, projectId: r.project_id, title: r.title, done: !!r.done, dueDate: r.due_date, createdAt: r.created_at, updatedAt: r.updated_at });
  const noteDto = (r) => ({ id: r.id, projectId: r.project_id, title: r.title, body: r.body, createdAt: r.created_at, updatedAt: r.updated_at });
  const fileDto = (r) => ({ id: r.id, projectId: r.project_id, name: r.name, kind: r.kind, size: r.size, createdAt: r.created_at });

  const SELECT = `SELECT p.*,
      (SELECT COUNT(*) FROM project_tasks t WHERE t.project_id = p.id) AS task_count,
      (SELECT COUNT(*) FROM project_tasks t WHERE t.project_id = p.id AND t.done = 1) AS done_count,
      (SELECT COUNT(*) FROM project_notes n WHERE n.project_id = p.id) AS note_count,
      (SELECT COUNT(*) FROM project_files f WHERE f.project_id = p.id) AS file_count
    FROM projects p`;

  const row = (table, id, what) => {
    const r = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
    if (!r) throw notFound(what);
    return r;
  };
  const touch = (projectId) => { db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now(), projectId); onChange(); };
  const dirOf = (projectId) => path.join(filesDir, projectId);
  const pathOf = (f) => path.join(dirOf(f.project_id), f.stored_name);

  // ---- projects
  function get(id) {
    const r = db.prepare(`${SELECT} WHERE p.id = ?`).get(id);
    if (!r) throw notFound('Project');
    return projectDto(r);
  }

  const list = () => db.prepare(`${SELECT} ORDER BY p.updated_at DESC`).all().map(projectDto);

  function detail(id) {
    return {
      ...get(id),
      tasks: db.prepare('SELECT * FROM project_tasks WHERE project_id = ? ORDER BY done, created_at').all(id).map(taskDto),
      notes: db.prepare('SELECT * FROM project_notes WHERE project_id = ? ORDER BY updated_at DESC').all(id).map(noteDto),
      files: db.prepare('SELECT * FROM project_files WHERE project_id = ? ORDER BY created_at DESC').all(id).map(fileDto),
    };
  }

  function create(input) {
    const id = crypto.randomUUID();
    const at = now();
    db.prepare('INSERT INTO projects (id, name, description, color, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, input.name, input.description ?? '', input.color ?? '#e8994a', input.status ?? 'active', at, at);
    onChange();
    return get(id);
  }

  function update(id, patch) {
    const cur = get(id);
    db.prepare('UPDATE projects SET name = ?, description = ?, color = ?, status = ?, updated_at = ? WHERE id = ?')
      .run(patch.name ?? cur.name, patch.description ?? cur.description, patch.color ?? cur.color, patch.status ?? cur.status, now(), id);
    onChange();
    return get(id);
  }

  function remove(id) {
    get(id);
    db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    fs.rmSync(dirOf(id), { recursive: true, force: true });
    onChange();
    return true;
  }

  // ---- tasks
  function addTask(projectId, input) {
    get(projectId);
    const id = crypto.randomUUID();
    const at = now();
    db.prepare('INSERT INTO project_tasks (id, project_id, title, due_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, projectId, input.title, input.dueDate ?? null, at, at);
    touch(projectId);
    return taskDto(row('project_tasks', id, 'Task'));
  }

  function updateTask(id, patch) {
    const cur = row('project_tasks', id, 'Task');
    db.prepare('UPDATE project_tasks SET title = ?, done = ?, due_date = ?, updated_at = ? WHERE id = ?')
      .run(patch.title ?? cur.title, patch.done == null ? cur.done : Number(patch.done), patch.dueDate === undefined ? cur.due_date : patch.dueDate, now(), id);
    touch(cur.project_id);
    return taskDto(row('project_tasks', id, 'Task'));
  }

  function removeTask(id) {
    const cur = row('project_tasks', id, 'Task');
    db.prepare('DELETE FROM project_tasks WHERE id = ?').run(id);
    touch(cur.project_id);
    return true;
  }

  // ---- notes
  function addNote(projectId, input = {}) {
    get(projectId);
    const id = crypto.randomUUID();
    const at = now();
    db.prepare('INSERT INTO project_notes (id, project_id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, projectId, input.title ?? '', input.body ?? '', at, at);
    touch(projectId);
    return noteDto(row('project_notes', id, 'Note'));
  }

  function updateNote(id, patch) {
    const cur = row('project_notes', id, 'Note');
    db.prepare('UPDATE project_notes SET title = ?, body = ?, updated_at = ? WHERE id = ?')
      .run(patch.title ?? cur.title, patch.body ?? cur.body, now(), id);
    touch(cur.project_id);
    return noteDto(row('project_notes', id, 'Note'));
  }

  function removeNote(id) {
    const cur = row('project_notes', id, 'Note');
    db.prepare('DELETE FROM project_notes WHERE id = ?').run(id);
    touch(cur.project_id);
    return true;
  }

  // ---- files
  // `sources` are absolute paths chosen in the main process's file dialog.
  function addFiles(projectId, sources) {
    get(projectId);
    fs.mkdirSync(dirOf(projectId), { recursive: true });
    const added = [];
    const skipped = [];
    for (const src of sources) {
      const name = path.basename(src);
      let size;
      try { size = fs.statSync(src).size; } catch { skipped.push({ name, reason: 'could not be read' }); continue; }
      if (size > MAX_FILE_BYTES) { skipped.push({ name, reason: 'is larger than 500 MB' }); continue; }
      const id = crypto.randomUUID();
      const ext = extOf(name);
      const stored = ext ? `${id}.${ext}` : id;
      fs.copyFileSync(src, path.join(dirOf(projectId), stored));
      db.prepare('INSERT INTO project_files (id, project_id, name, stored_name, kind, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, projectId, name, stored, kindOf(name), size, now());
      added.push(fileDto(row('project_files', id, 'File')));
    }
    if (added.length) touch(projectId);
    return { added, skipped };
  }

  function removeFile(id) {
    const f = row('project_files', id, 'File');
    db.prepare('DELETE FROM project_files WHERE id = ?').run(id);
    fs.rmSync(pathOf(f), { force: true });
    touch(f.project_id);
    return true;
  }

  const filePath = (id) => pathOf(row('project_files', id, 'File'));

  // Image thumbnails as data URLs, so the renderer never needs file:// access.
  function preview(id) {
    const f = row('project_files', id, 'File');
    const mime = MIME[extOf(f.name)];
    if (f.kind !== 'image' || !mime || f.size > MAX_PREVIEW_BYTES) return null;
    try { return `data:${mime};base64,${fs.readFileSync(pathOf(f)).toString('base64')}`; } catch { return null; }
  }

  return {
    list, get, detail, create, update, remove,
    addTask, updateTask, removeTask,
    addNote, updateNote, removeNote,
    addFiles, removeFile, filePath, preview,
  };
}

module.exports = { createProjectService, kindOf };
