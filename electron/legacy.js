// One-time import of the v1 data.json (pre-SQLite) into the database.
// The old file is renamed, not deleted, so nothing is lost if this fails.
const fs = require('fs');
const path = require('path');
const { tx } = require('./database/db');

function importLegacy({ db, dir, tasks, settings, log }) {
  const file = path.join(dir, 'data.json');
  if (!fs.existsSync(file) || settings.getInternal('legacyImported')) return 0;
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    log.warn('legacy data.json unreadable; skipping import', { error: err.message });
    return 0;
  }

  const zone = settings.get('timeZone');
  let count = 0;
  tx(db, () => {
    const s = data.settings || {};
    const patch = {};
    if (typeof s.character === 'string') patch.character = s.character;
    if (typeof s.speak === 'boolean') patch.speech = s.speak;
    if (Number.isInteger(s.breakEveryMin)) patch.breakEveryMin = s.breakEveryMin;
    if (Number.isInteger(s.snoozeMin)) patch.defaultSnoozeMinutes = s.snoozeMin;
    if (Object.keys(patch).length) settings.update(patch);

    for (const t of Array.isArray(data.tasks) ? data.tasks : []) {
      if (!t || typeof t.title !== 'string' || !t.title.trim()) continue;
      const due = t.due && !Number.isNaN(Date.parse(t.due)) ? new Date(t.due).toISOString() : null;
      const created = tasks.create({
        title: t.title.trim().slice(0, 200), description: '', notes: '', link: '', category: '', priority: 'MEDIUM',
        dueAt: due, timeZone: zone, leadMinutes: 0,
        recurrence: ['daily', 'weekly'].includes(t.repeat) && due ? { type: t.repeat } : null,
      });
      if (t.done) tasks.complete(created.id);
      count++;
    }
    settings.setInternal('legacyImported', new Date().toISOString());
  });
  fs.renameSync(file, `${file}.imported`);
  log.info('imported legacy data', { tasks: count });
  return count;
}

module.exports = { importLegacy };
