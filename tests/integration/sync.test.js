// End-to-end: two "devices" (separate SQLite databases) syncing through the
// real Express server backed by an in-memory MongoDB.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { makeStack, silentLog } from '../unit/helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRequire = createRequire(path.join(here, '../../server/package.json'));
const require = createRequire(import.meta.url);

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'integration-secret-that-is-long-enough-123456';
process.env.BCRYPT_ROUNDS = '4';

const { MongoMemoryServer } = serverRequire('mongodb-memory-server');
const mongoose = serverRequire('mongoose');
const { createApp } = require('../../server/src/app');
const { createSync } = require('../../electron/sync/client');

let mongod;
let server;
let baseUrl;
let online = true;

// fetch wrapper that can simulate losing the network
const flakyFetch = (...args) => (online ? fetch(...args) : Promise.reject(new TypeError('fetch failed')));

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  server = createApp({ rateLimits: false }).listen(0);
  baseUrl = `http://localhost:${server.address().port}`;
}, 120_000);

afterAll(async () => {
  server?.close();
  await mongoose.disconnect();
  await mongod?.stop();
});

function device() {
  let token = null;
  let syncOn = false;
  const s = makeStack({ start: new Date().toISOString() });
  // Rebuild the task service so writes are queued when signed in.
  const { createTaskService } = require('../../electron/services/tasks');
  s.tasks = createTaskService({ db: s.db, clock: s.clock, shouldSync: () => syncOn });
  s.sync = createSync({
    db: s.db, tasks: s.tasks, settings: s.settings, log: silentLog, fetchImpl: flakyFetch,
    getToken: () => token, setToken: (t) => { token = t; syncOn = !!t; },
  });
  return s;
}

describe('offline-first sync', () => {
  it('syncs tasks between devices, survives offline periods and propagates deletes', async () => {
    const laptop = device();
    const desktop = device();
    const email = `sync${Date.now()}@example.com`;

    // Laptop creates a task before ever signing in, then registers: existing tasks upload.
    laptop.tasks.create(laptop.input({ title: 'Review emails', dueAt: new Date(Date.now() + 3600_000).toISOString(), recurrence: { type: 'daily' } }));
    await laptop.sync.signIn({ email, password: 'correct-horse', serverUrl: baseUrl, register: true });
    expect(laptop.sync.status().pending).toBe(0);

    await desktop.sync.signIn({ email, password: 'correct-horse', serverUrl: baseUrl });
    expect(desktop.tasks.list().map((t) => t.title)).toEqual(['Review emails']);

    // Laptop goes offline and keeps working; changes queue locally.
    online = false;
    const offlineTask = laptop.tasks.create(laptop.input({ title: 'Written offline' }));
    await laptop.sync.syncNow();
    expect(laptop.sync.status().pending).toBe(1);
    expect(laptop.sync.status().lastError).toMatch(/Can't reach the sync server/);
    expect(laptop.tasks.list()).toHaveLength(2); // local use unaffected

    // Connection returns: the queued op (after its backoff) is pushed.
    online = true;
    laptop.db.prepare('UPDATE outbox SET next_attempt_at = NULL').run();
    await laptop.sync.syncNow();
    expect(laptop.sync.status().pending).toBe(0);
    await desktop.sync.syncNow();
    expect(desktop.tasks.list().map((t) => t.title).sort()).toEqual(['Review emails', 'Written offline']);

    // Delete on desktop reaches the laptop.
    desktop.tasks.remove(offlineTask.id);
    await desktop.sync.syncNow();
    await laptop.sync.syncNow();
    expect(laptop.tasks.list().map((t) => t.title)).toEqual(['Review emails']);
  });

  it('a retried push after a lost response does not duplicate tasks', async () => {
    const a = device();
    await a.sync.signIn({ email: `retry${Date.now()}@example.com`, password: 'correct-horse', serverUrl: baseUrl, register: true });
    a.tasks.create(a.input({ title: 'Only once' }));
    const op = a.db.prepare('SELECT * FROM outbox').get();
    await a.sync.syncNow();
    // Simulate the response having been lost: the same op is sent again.
    a.db.prepare('INSERT INTO outbox (op_id, task_id, op, payload, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(op.op_id, op.task_id, op.op, op.payload, op.created_at);
    await a.sync.syncNow();
    const exported = await a.sync.exportCloud();
    expect(exported.tasks.filter((t) => t.title === 'Only once')).toHaveLength(1);
  });

  it('expired sessions sign out instead of retrying forever', async () => {
    const a = device();
    await a.sync.signIn({ email: `exp${Date.now()}@example.com`, password: 'correct-horse', serverUrl: baseUrl, register: true });
    await a.sync.deleteAccount();
    expect(a.sync.status().signedIn).toBe(false);
  });
});
