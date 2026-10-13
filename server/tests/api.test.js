import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createRequire } from 'module';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-1234567890';
process.env.BCRYPT_ROUNDS = '4';

const require = createRequire(import.meta.url);
const mongoose = require('mongoose');
const { createApp } = require('../src/app');

let mongod;
let app;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  app = createApp({ rateLimits: false });
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod?.stop();
});

beforeEach(async () => {
  await Promise.all(Object.values(mongoose.models).map((m) => m.deleteMany({})));
});

async function signUp(email = `u${Math.random()}@example.com`) {
  const res = await request(app).post('/api/auth/register').send({ email, password: 'correct-horse' });
  expect(res.status).toBe(201);
  return { token: res.body.token, auth: { Authorization: `Bearer ${res.body.token}` }, email };
}

const task = (over = {}) => ({
  id: randomUUID(),
  title: 'Submit weekly report',
  timeZone: 'Asia/Kolkata',
  dueAt: '2026-10-16T09:30:00.000Z',
  recurrence: { type: 'weekly' },
  createdAt: '2026-10-12T08:00:00.000Z',
  updatedAt: '2026-10-12T08:00:00.000Z',
  ...over,
});

const push = (auth, ops) => request(app).post('/api/sync/push').set(auth).send({ ops });

describe('auth', () => {
  it('registers, logs in and rejects bad passwords without revealing which part was wrong', async () => {
    const { email } = await signUp('a@example.com');
    const ok = await request(app).post('/api/auth/login').send({ email, password: 'correct-horse' });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeTruthy();
    expect(ok.body.user.passwordHash).toBeUndefined();

    const bad = await request(app).post('/api/auth/login').send({ email, password: 'wrong-password' });
    expect(bad.status).toBe(401);
    const unknown = await request(app).post('/api/auth/login').send({ email: 'nobody@example.com', password: 'wrong-password' });
    expect(unknown.body.error).toBe(bad.body.error);
  });

  it('rejects duplicate registrations and invalid input', async () => {
    await signUp('dup@example.com');
    expect((await request(app).post('/api/auth/register').send({ email: 'dup@example.com', password: 'correct-horse' })).status).toBe(409);
    expect((await request(app).post('/api/auth/register').send({ email: 'x', password: '1' })).status).toBe(400);
  });

  it('requires a valid token for the API', async () => {
    expect((await request(app).get('/api/tasks')).status).toBe(401);
    expect((await request(app).get('/api/tasks').set({ Authorization: 'Bearer nope' })).status).toBe(401);
  });
});

describe('tasks and ownership', () => {
  it('creates, lists, completes and deletes tasks', async () => {
    const { auth } = await signUp();
    const t = task({ recurrence: null });
    expect((await request(app).post('/api/tasks').set(auth).send(t)).status).toBe(201);

    const list = await request(app).get('/api/tasks').set(auth);
    expect(list.body.tasks.map((x) => x.id)).toEqual([t.id]);

    const done = await request(app).post(`/api/tasks/${t.id}/complete`).set(auth);
    expect(done.body.task.status).toBe('COMPLETED');

    expect((await request(app).delete(`/api/tasks/${t.id}`).set(auth)).status).toBe(200);
    expect((await request(app).get(`/api/tasks/${t.id}`).set(auth)).status).toBe(404);
  });

  it('completing a recurring occurrence advances instead of finishing the series', async () => {
    const { auth } = await signUp();
    const t = task({ nextOccurrenceAt: '2026-10-16T09:30:00.000Z' });
    await request(app).post('/api/tasks').set(auth).send(t);
    const res = await request(app).post(`/api/tasks/${t.id}/complete`).set(auth);
    expect(res.body.task.status).toBe('PENDING');
    expect(Date.parse(res.body.task.nextOccurrenceAt)).toBeGreaterThan(Date.parse('2026-10-16T09:30:00.000Z'));
  });

  it("never exposes or modifies another user's task, even with its id", async () => {
    const alice = await signUp();
    const bob = await signUp();
    const t = task();
    await request(app).post('/api/tasks').set(alice.auth).send(t);

    expect((await request(app).get(`/api/tasks/${t.id}`).set(bob.auth)).status).toBe(404);
    expect((await request(app).delete(`/api/tasks/${t.id}`).set(bob.auth)).status).toBe(404);
    const hijack = await push(bob.auth, [{ opId: randomUUID(), op: 'upsert', task: { ...t, title: 'pwned', updatedAt: '2030-01-01T00:00:00.000Z' } }]);
    expect(hijack.body.results[0].status).toBe('rejected');
    expect((await request(app).get(`/api/tasks/${t.id}`).set(alice.auth)).body.task.title).toBe('Submit weekly report');
    expect((await request(app).get('/api/tasks').set(bob.auth)).body.tasks).toHaveLength(0);
  });

  it('ignores a userId smuggled into the body', async () => {
    const alice = await signUp();
    const bob = await signUp();
    const me = await request(app).get('/api/me').set(alice.auth);
    const t = task({ userId: me.body.user.id });
    await request(app).post('/api/tasks').set(bob.auth).send(t);
    expect((await request(app).get('/api/tasks').set(alice.auth)).body.tasks).toHaveLength(0);
  });

  it('rejects malformed tasks', async () => {
    const { auth } = await signUp();
    expect((await request(app).post('/api/tasks').set(auth).send(task({ timeZone: 'Mars/Olympus' }))).status).toBe(400);
    expect((await request(app).post('/api/tasks').set(auth).send(task({ title: '' }))).status).toBe(400);
    expect((await request(app).post('/api/tasks').set(auth).send(task({ link: 'javascript:alert(1)' }))).status).toBe(400);
  });
});

describe('sync', () => {
  it('applies each operation once even when the request is retried', async () => {
    const { auth } = await signUp();
    const op = { opId: randomUUID(), op: 'upsert', task: task() };
    const first = await push(auth, [op]);
    const retry = await push(auth, [op]);
    expect(first.body.results[0].status).toBe('applied');
    expect(retry.body.results[0]).toMatchObject({ status: 'applied', duplicate: true });
    const tasks = (await request(app).get('/api/tasks').set(auth)).body.tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].version).toBe(1);
  });

  it('last writer wins on updatedAt', async () => {
    const { auth } = await signUp();
    const t = task();
    await push(auth, [{ opId: randomUUID(), op: 'upsert', task: { ...t, title: 'newer', updatedAt: '2026-10-12T10:00:00.000Z' } }]);
    const stale = await push(auth, [{ opId: randomUUID(), op: 'upsert', task: { ...t, title: 'older', updatedAt: '2026-10-12T09:00:00.000Z' } }]);
    expect(stale.body.results[0].status).toBe('conflict');
    expect(stale.body.results[0].task.title).toBe('newer');
  });

  it('a tombstone stops an older offline copy from resurrecting the task', async () => {
    const { auth } = await signUp();
    const t = task();
    await push(auth, [{ opId: randomUUID(), op: 'upsert', task: t }]);
    await push(auth, [{ opId: randomUUID(), op: 'delete', task: { id: t.id, deletedAt: '2026-10-12T12:00:00.000Z' } }]);
    const resurrect = await push(auth, [{ opId: randomUUID(), op: 'upsert', task: { ...t, updatedAt: '2026-10-12T11:00:00.000Z' } }]);
    expect(resurrect.body.results[0].status).toBe('conflict');
    expect(resurrect.body.results[0].task.deletedAt).toBeTruthy();
  });

  it('change feed pages through everything, including tombstones, without gaps', async () => {
    const { auth } = await signUp();
    const ids = [];
    for (let i = 0; i < 7; i++) {
      const t = task({ title: `T${i}` });
      ids.push(t.id);
      await push(auth, [{ opId: randomUUID(), op: 'upsert', task: t }]);
    }
    await push(auth, [{ opId: randomUUID(), op: 'delete', task: { id: ids[0] } }]);

    const seen = new Map();
    let cursor;
    for (let guard = 0; guard < 10; guard++) {
      const res = await request(app).get('/api/sync/changes').query({ since: cursor, limit: 3 }).set(auth);
      for (const t of res.body.tasks) seen.set(t.id, t);
      cursor = res.body.cursor;
      if (!res.body.hasMore) break;
    }
    expect(seen.size).toBe(7);
    expect(seen.get(ids[0]).deletedAt).toBeTruthy();

    const none = await request(app).get('/api/sync/changes').query({ since: cursor }).set(auth);
    expect(none.body.tasks).toHaveLength(0);
  });
});

describe('account', () => {
  it('exports and deletes all account data', async () => {
    const { auth } = await signUp();
    await request(app).post('/api/tasks').set(auth).send(task());
    const exp = await request(app).get('/api/me/export').set(auth);
    expect(exp.body.tasks).toHaveLength(1);
    expect((await request(app).delete('/api/me').set(auth)).status).toBe(204);
    expect((await request(app).get('/api/me').set(auth)).status).toBe(401);
  });

  it('stores character preferences', async () => {
    const { auth } = await signUp();
    const res = await request(app).patch('/api/me/preferences').set(auth).send({ character: 'tom' });
    expect(res.body.user.preferences.character).toBe('tom');
    expect((await request(app).patch('/api/me/preferences').set(auth).send({ isAdmin: true })).status).toBe(400);
  });
});

describe('health', () => {
  it('reports database status', async () => {
    const res = await request(app).get('/health');
    expect(res.body).toEqual({ status: 'ok', db: 'up' });
  });
});
