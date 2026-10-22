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
  {
    version: 4,
    name: 'habits',
    up(db) {
      db.exec(`
        CREATE TABLE habits (
          id          TEXT PRIMARY KEY,
          name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
          description TEXT NOT NULL DEFAULT '',
          icon        TEXT NOT NULL DEFAULT '⭐',
          color       TEXT NOT NULL DEFAULT '#e8994a',
          frequency   TEXT NOT NULL DEFAULT 'daily',
          target_days TEXT NOT NULL DEFAULT '[1,2,3,4,5,6,7]',
          archived    INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
          sort_order  INTEGER NOT NULL DEFAULT 0,
          created_at  TEXT NOT NULL,
          updated_at  TEXT NOT NULL
        );
        CREATE INDEX idx_habits_sort ON habits(archived, sort_order);

        CREATE TABLE habit_completions (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          habit_id   TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
          date       TEXT NOT NULL,
          note       TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          UNIQUE (habit_id, date)
        );
        CREATE INDEX idx_habit_comp_date ON habit_completions(habit_id, date);
      `);
    },
  },
  {
    version: 5,
    name: 'projects',
    up(db) {
      db.exec(`
        CREATE TABLE projects (
          id          TEXT PRIMARY KEY,
          name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
          description TEXT NOT NULL DEFAULT '',
          color       TEXT NOT NULL DEFAULT '#e8994a',
          status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','on_hold','done')),
          created_at  TEXT NOT NULL,
          updated_at  TEXT NOT NULL
        );
        CREATE INDEX idx_projects_updated ON projects(updated_at DESC);

        CREATE TABLE project_tasks (
          id         TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          title      TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
          done       INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0,1)),
          due_date   TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX idx_project_tasks ON project_tasks(project_id, done, created_at);

        CREATE TABLE project_notes (
          id         TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          title      TEXT NOT NULL DEFAULT '',
          body       TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX idx_project_notes ON project_notes(project_id, updated_at DESC);

        CREATE TABLE project_files (
          id          TEXT PRIMARY KEY,
          project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          name        TEXT NOT NULL,
          stored_name TEXT NOT NULL,
          kind        TEXT NOT NULL DEFAULT 'other',
          size        INTEGER NOT NULL DEFAULT 0,
          created_at  TEXT NOT NULL
        );
        CREATE INDEX idx_project_files ON project_files(project_id, created_at DESC);
      `);
    },
  },
];

