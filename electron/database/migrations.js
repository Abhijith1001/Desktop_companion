// Ordered, append-only schema migrations. Never edit a shipped migration;
// add a new one instead so existing user databases upgrade in place.
module.exports = [
  {
    version: 1,
    name: 'initial schema',
    up(db) {
      db.exec(`
        CREATE TABLE tasks (
          id                 TEXT PRIMARY KEY,
          title              TEXT NOT NULL,
          description        TEXT NOT NULL DEFAULT '',
          notes              TEXT NOT NULL DEFAULT '',
          link               TEXT NOT NULL DEFAULT '',
          category           TEXT NOT NULL DEFAULT '',
          priority           TEXT NOT NULL DEFAULT 'MEDIUM',
          status             TEXT NOT NULL DEFAULT 'PENDING',
          due_at             TEXT,
          time_zone          TEXT NOT NULL,
          recurrence         TEXT,
          lead_minutes       INTEGER NOT NULL DEFAULT 0,
          next_occurrence_at TEXT,
          created_at         TEXT NOT NULL,
          updated_at         TEXT NOT NULL,
          completed_at       TEXT,
          deleted_at         TEXT,
          version            INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX idx_tasks_next ON tasks(status, next_occurrence_at);
        CREATE INDEX idx_tasks_due ON tasks(due_at);

        CREATE TABLE occurrences (
          id            TEXT PRIMARY KEY,
          task_id       TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          scheduled_at  TEXT NOT NULL,
          remind_at     TEXT NOT NULL,
          snoozed_until TEXT,
          status        TEXT NOT NULL DEFAULT 'PENDING',
          resolved_at   TEXT,
          UNIQUE (task_id, scheduled_at)
        );
        CREATE INDEX idx_occ_status ON occurrences(status, remind_at);

        CREATE TABLE deliveries (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          occurrence_id TEXT NOT NULL REFERENCES occurrences(id) ON DELETE CASCADE,
          fire_at       TEXT NOT NULL,
          state         TEXT NOT NULL,
          attempts      INTEGER NOT NULL DEFAULT 0,
          claimed_at    TEXT,
          delivered_at  TEXT,
          error         TEXT,
          UNIQUE (occurrence_id, fire_at)
        );
        CREATE INDEX idx_deliveries_state ON deliveries(state);

        CREATE TABLE settings (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE outbox (
          op_id           TEXT PRIMARY KEY,
          task_id         TEXT NOT NULL,
          op              TEXT NOT NULL,
          payload         TEXT NOT NULL,
          created_at      TEXT NOT NULL,
          attempts        INTEGER NOT NULL DEFAULT 0,
          next_attempt_at TEXT,
          last_error      TEXT
        );
        CREATE INDEX idx_outbox_created ON outbox(created_at);

        CREATE TABLE activity (
          id      INTEGER PRIMARY KEY AUTOINCREMENT,
          type    TEXT NOT NULL,
          task_id TEXT,
          at      TEXT NOT NULL,
          meta    TEXT
        );
        CREATE INDEX idx_activity_at ON activity(at);
      `);
    },
  },
  {
    version: 2,
    name: 'bookmarks',
    up(db) {
      // Local-only: bookmarks are never added to the sync outbox.
      db.exec(`
        CREATE TABLE bookmarks (
          id           TEXT PRIMARY KEY,
          title        TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
          text         TEXT NOT NULL CHECK (length(text) >= 1),
          source_app   TEXT,
          source_title TEXT,
          source_url   TEXT,
          capture_method TEXT,
          notes        TEXT NOT NULL DEFAULT '',
          is_favorite  INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1)),
          content_hash TEXT NOT NULL,
          created_at   TEXT NOT NULL,
          updated_at   TEXT NOT NULL
        );
        CREATE INDEX idx_bookmarks_created ON bookmarks(created_at DESC);
        CREATE INDEX idx_bookmarks_app ON bookmarks(source_app);
        CREATE INDEX idx_bookmarks_hash ON bookmarks(content_hash);

        CREATE TABLE bookmark_tags (
          bookmark_id TEXT NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
          tag         TEXT NOT NULL COLLATE NOCASE,
          PRIMARY KEY (bookmark_id, tag)
        );
        CREATE INDEX idx_bookmark_tags_tag ON bookmark_tags(tag);

        CREATE VIRTUAL TABLE bookmarks_fts USING fts5(
          title, text, notes, content='bookmarks', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2'
        );
        CREATE TRIGGER bookmarks_ai AFTER INSERT ON bookmarks BEGIN
          INSERT INTO bookmarks_fts(rowid, title, text, notes) VALUES (new.rowid, new.title, new.text, new.notes);
        END;
        CREATE TRIGGER bookmarks_ad AFTER DELETE ON bookmarks BEGIN
          INSERT INTO bookmarks_fts(bookmarks_fts, rowid, title, text, notes) VALUES ('delete', old.rowid, old.title, old.text, old.notes);
        END;
        CREATE TRIGGER bookmarks_au AFTER UPDATE ON bookmarks BEGIN
          INSERT INTO bookmarks_fts(bookmarks_fts, rowid, title, text, notes) VALUES ('delete', old.rowid, old.title, old.text, old.notes);
          INSERT INTO bookmarks_fts(rowid, title, text, notes) VALUES (new.rowid, new.title, new.text, new.notes);
        END;
      `);
    },
  },
  {
    version: 3,
    name: 'notepad',
    up(db) {
      db.exec(`
        CREATE TABLE notes (
          id         TEXT PRIMARY KEY,
          title      TEXT NOT NULL DEFAULT '',
          body       TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX idx_notes_updated ON notes(updated_at DESC);
      `);
    },
  },
];
