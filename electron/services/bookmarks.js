// Saved text snippets ("bookmarks"). Local-only: never synced or uploaded.
// Search uses the bookmarks_fts FTS5 index; tags live in bookmark_tags.
const crypto = require('crypto');
const { tx } = require('../database/db');

// Same text from the same place counts as a duplicate (whitespace/case-insensitive).
function contentHash(text, sourceUrl) {
  const norm = String(text).replace(/\s+/g, ' ').trim().toLowerCase();
  return crypto.createHash('sha256').update(`${norm}\u0000${sourceUrl || ''}`).digest('hex');
}

// Turns free text into a safe FTS5 prefix query: every word must match.
function ftsQuery(q) {
  const words = String(q).match(/[\p{L}\p{N}_]+/gu) || [];
  return words.slice(0, 12).map((w) => `"${w}"*`).join(' ');
}

function createBookmarkService({ db, clock = () => new Date(), onChange = () => {} }) {
  const now = () => clock().toISOString();

  const tagsOf = (id) => db.prepare('SELECT tag FROM bookmark_tags WHERE bookmark_id = ? ORDER BY tag').all(id).map((r) => r.tag);

  const toDto = (row) => row && ({
    id: row.id,
    title: row.title,
    text: row.text,
    sourceApp: row.source_app,
    sourceTitle: row.source_title,
    sourceUrl: row.source_url,
    captureMethod: row.capture_method,
    notes: row.notes,
    tags: tagsOf(row.id),
    isFavorite: row.is_favorite === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

  const mustGet = (id) => {
    const row = db.prepare('SELECT rowid, * FROM bookmarks WHERE id = ?').get(id);
    if (!row) {
      const err = new Error('Bookmark not found');
      err.code = 'NOT_FOUND';
      throw err;
    }
    return row;
  };

  const setTags = (id, tags) => {
    db.prepare('DELETE FROM bookmark_tags WHERE bookmark_id = ?').run(id);
    const ins = db.prepare('INSERT OR IGNORE INTO bookmark_tags (bookmark_id, tag) VALUES (?, ?)');
    for (const t of tags) ins.run(id, t);
  };

  const findDuplicate = (text, sourceUrl) => {
    const row = db.prepare('SELECT * FROM bookmarks WHERE content_hash = ? LIMIT 1').get(contentHash(text, sourceUrl));
    return row ? toDto(row) : null;
  };

  // Returns { bookmark } or, when the same text is already saved and
  // allowDuplicate is not set, { duplicate } without writing anything.
  function create(input, { allowDuplicate = false } = {}) {
    const existing = findDuplicate(input.text, input.sourceUrl);
    if (existing && !allowDuplicate) return { duplicate: existing };
    const id = crypto.randomUUID();
    const at = now();
    tx(db, () => {
      db.prepare(`INSERT INTO bookmarks (id, title, text, source_app, source_title, source_url, capture_method,
          notes, is_favorite, content_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, input.title, input.text, input.sourceApp, input.sourceTitle, input.sourceUrl, input.captureMethod,
          input.notes, input.isFavorite ? 1 : 0, contentHash(input.text, input.sourceUrl), at, at);
      setTags(id, input.tags);
    });
    onChange();
    return { bookmark: get(id) };
  }

  // Partial update; the captured text and source stay as captured unless given.
  function update(id, patch) {
    const row = mustGet(id);
    const next = {
      title: patch.title ?? row.title,
      text: patch.text ?? row.text,
      notes: patch.notes ?? row.notes,
      source_url: patch.sourceUrl !== undefined ? patch.sourceUrl : row.source_url,
      is_favorite: patch.isFavorite !== undefined ? (patch.isFavorite ? 1 : 0) : row.is_favorite,
    };
    tx(db, () => {
      db.prepare(`UPDATE bookmarks SET title = ?, text = ?, notes = ?, source_url = ?, is_favorite = ?,
          content_hash = ?, updated_at = ? WHERE id = ?`)
        .run(next.title, next.text, next.notes, next.source_url, next.is_favorite,
          contentHash(next.text, next.source_url), now(), id);
      if (patch.tags) setTags(id, patch.tags);
    });
    onChange();
    return get(id);
  }

  function get(id) {
    return toDto(mustGet(id));
  }

  function remove(id) {
    mustGet(id);
    db.prepare('DELETE FROM bookmarks WHERE id = ?').run(id);
    onChange();
    return true;
  }

  function clearAll() {
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM bookmarks').get();
    tx(db, () => {
      db.exec('DELETE FROM bookmarks');
      db.exec("INSERT INTO bookmarks_fts(bookmarks_fts) VALUES ('rebuild')");
    });
    onChange();
    return n;
  }

  // filter: { q, app, tag, favorite, from, to, limit, offset }
  function list(filter = {}) {
    const where = [];
    const args = [];
    let from = 'bookmarks b';
    let order = 'b.created_at DESC';
    const fts = filter.q ? ftsQuery(filter.q) : '';
    if (filter.q && !fts) return { items: [], total: 0 };
    if (fts) {
      from = 'bookmarks_fts f JOIN bookmarks b ON b.rowid = f.rowid';
      where.push('bookmarks_fts MATCH ?');
      args.push(fts);
      order = 'bm25(bookmarks_fts, 5.0, 1.0, 1.0), b.created_at DESC';
    }
    if (filter.app) { where.push('b.source_app = ?'); args.push(filter.app); }
    if (filter.favorite) where.push('b.is_favorite = 1');
    if (filter.tag) { where.push('EXISTS (SELECT 1 FROM bookmark_tags t WHERE t.bookmark_id = b.id AND t.tag = ?)'); args.push(filter.tag); }
    if (filter.from) { where.push('b.created_at >= ?'); args.push(filter.from); }
    if (filter.to) { where.push('b.created_at <= ?'); args.push(filter.to); }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) AS n FROM ${from} ${w}`).get(...args).n;
    const rows = db.prepare(`SELECT b.* FROM ${from} ${w} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .all(...args, filter.limit ?? 50, filter.offset ?? 0);
    return { items: rows.map(toDto), total };
  }

  const recent = (limit = 5) => list({ limit }).items;

  // Values for the filter dropdowns.
  function facets() {
    return {
      apps: db.prepare('SELECT source_app AS app, COUNT(*) AS n FROM bookmarks WHERE source_app IS NOT NULL GROUP BY source_app ORDER BY n DESC').all()
        .map((r) => ({ app: r.app, count: r.n })),
      tags: db.prepare('SELECT tag, COUNT(*) AS n FROM bookmark_tags GROUP BY tag ORDER BY tag').all()
        .map((r) => ({ tag: r.tag, count: r.n })),
      total: db.prepare('SELECT COUNT(*) AS n FROM bookmarks').get().n,
    };
  }

  const exportAll = () => db.prepare('SELECT * FROM bookmarks ORDER BY created_at').all().map(toDto);

  return { create, update, get, remove, clearAll, list, recent, facets, findDuplicate, exportAll };
}

module.exports = { createBookmarkService, contentHash, ftsQuery };
