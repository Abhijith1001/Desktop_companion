// SQLite access using Node's built-in driver (no native modules to rebuild).
const { DatabaseSync } = require('node:sqlite');
const migrations = require('./migrations');

function open(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db._txDepth = 0;
  migrate(db);
  return db;
}

// Runs fn inside a transaction. Nested calls join the outer transaction.
function tx(db, fn) {
  if (db._txDepth > 0) return fn();
  db.exec('BEGIN IMMEDIATE');
  db._txDepth++;
  try {
    const result = fn();
    db._txDepth--;
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db._txDepth--;
    db.exec('ROLLBACK');
    throw err;
  }
}

function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT NOT NULL)');
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version));
  for (const m of migrations) {
    if (applied.has(m.version)) continue;
    tx(db, () => {
      m.up(db);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
        .run(m.version, m.name, new Date().toISOString());
    });
  }
}

function schemaVersion(db) {
  return db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v || 0;
}

module.exports = { open, tx, schemaVersion };
