import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createRequire } from 'module';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-1234567890';
process.env.BCRYPT_ROUNDS = '4';
process.env.ADMIN_TOKEN = 'admin-token-that-is-long-enough-123';

const require = createRequire(import.meta.url);
const mongoose = require('mongoose');
const { createApp } = require('../src/app');

const admin = { Authorization: `Bearer ${process.env.ADMIN_TOKEN}` };
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

describe('public feedback', () => {
  it('stores feedback without an account and shows it to the admin', async () => {
    const res = await request(app).post('/api/public/feedback').send({ kind: 'idea', message: 'Add a panda!', appVersion: '2.2.0', os: 'Windows 11' });
    expect(res.status).toBe(201);
    const list = await request(app).get('/api/admin/feedback?status=new').set(admin);
    expect(list.body.feedback).toHaveLength(1);
    expect(list.body.feedback[0]).toMatchObject({ kind: 'idea', message: 'Add a panda!', status: 'new' });

    const id = list.body.feedback[0].id;
    expect((await request(app).patch(`/api/admin/feedback/${id}`).set(admin).send({ status: 'done' })).status).toBe(200);
    expect((await request(app).get('/api/admin/stats').set(admin)).body.feedbackNew).toBe(0);
  });

  it('rejects empty messages and bad emails', async () => {
    expect((await request(app).post('/api/public/feedback').send({ message: '' })).status).toBe(400);
    expect((await request(app).post('/api/public/feedback').send({ message: 'hello there', email: 'nope' })).status).toBe(400);
  });
});

describe('crash reports', () => {
  it('groups identical crashes and strips user folders', async () => {
    const crash = { source: 'main', message: 'boom', stack: 'Error: boom\n at C:\\Users\\alice\\app\\main.js:1:1', appVersion: '2.2.0' };
    await request(app).post('/api/public/crash').send(crash).expect(202);
    await request(app).post('/api/public/crash').send({ ...crash, stack: crash.stack.replace('alice', 'bob') }).expect(202);
    const { body } = await request(app).get('/api/admin/crashes').set(admin);
    expect(body.crashes).toHaveLength(1);
    expect(body.crashes[0].count).toBe(2);
    expect(body.crashes[0].stack).not.toMatch(/alice|bob/);
    expect(body.crashes[0].fingerprint).toBeUndefined();
  });
});

describe('announcements', () => {
  it('only serves active announcements inside their window', async () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    await request(app).post('/api/admin/announcements').set(admin).send({ title: 'Live now' }).expect(201);
    await request(app).post('/api/admin/announcements').set(admin).send({ title: 'Off', active: false }).expect(201);
    await request(app).post('/api/admin/announcements').set(admin).send({ title: 'Expired', endsAt: past }).expect(201);
    const { body } = await request(app).get('/api/public/announcements').expect(200);
    expect(body.announcements.map((a) => a.title)).toEqual(['Live now']);
  });

  it('only allows https links', async () => {
    expect((await request(app).post('/api/admin/announcements').set(admin).send({ title: 'x', link: 'javascript:alert(1)' })).status).toBe(400);
  });
});

describe('admin auth', () => {
  it('rejects missing or wrong tokens', async () => {
    expect((await request(app).get('/api/admin/stats')).status).toBe(401);
    expect((await request(app).get('/api/admin/stats').set({ Authorization: 'Bearer wrong' })).status).toBe(401);
  });

  it('serves the admin page and deletes users with their tasks', async () => {
    expect((await request(app).get('/admin/')).status).toBe(200);
    const reg = await request(app).post('/api/auth/register').send({ email: 'x@example.com', password: 'correct-horse' });
    const { body } = await request(app).get('/api/admin/users').set(admin);
    expect(body.users[0].email).toBe('x@example.com');
    await request(app).delete(`/api/admin/users/${reg.body.user.id}`).set(admin).expect(204);
    expect((await request(app).get('/api/admin/users').set(admin)).body.total).toBe(0);
  });
});
