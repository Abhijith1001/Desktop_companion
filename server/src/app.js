const path = require('path');
const express = require('express');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { config } = require('./config');
const { User, Task, ProcessedOp } = require('./models');
const { schemas } = require('./validation');
const { requireAuth, validate, errorHandler } = require('./middleware');
const svc = require('./services/taskService');
const { isHealthy } = require('./db');
const { publicRoutes } = require('./routes/public');
const { adminRoutes } = require('./routes/admin');

const { HttpError } = svc;

function publicUser(u) {
  return { id: String(u._id), email: u.email, preferences: u.preferences, createdAt: u.createdAt };
}

const signToken = (user) => jwt.sign({ sub: String(user._id) }, config.jwtSecret, { algorithm: 'HS256', expiresIn: config.jwtExpiresIn });

function createApp({ rateLimits = true } = {}) {
  const app = express();
  if (config.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));

  const limiter = (max, windowMs) => (rateLimits
    ? rateLimit({ windowMs, limit: max, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many requests, slow down' } })
    : (_req, _res, next) => next());

  app.get('/health', (_req, res) => {
    const db = isHealthy();
    res.status(db ? 200 : 503).json({ status: db ? 'ok' : 'degraded', db: db ? 'up' : 'down' });
  });

  // ---------- auth
  const auth = express.Router();
  auth.use(limiter(20, 15 * 60_000));
  auth.post('/register', validate(schemas.credentials), async (req, res) => {
    const { email, password } = req.valid;
    if (await User.exists({ email })) throw new HttpError(409, 'An account with this email already exists');
    const user = await User.create({ email, passwordHash: await bcrypt.hash(password, config.bcryptRounds) });
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  });
  auth.post('/login', validate(schemas.credentials), async (req, res) => {
    const { email, password } = req.valid;
    const user = await User.findOne({ email });
    const ok = user && (await bcrypt.compare(password, user.passwordHash));
    if (!ok) throw new HttpError(401, 'Invalid email or password');
    res.json({ token: signToken(user), user: publicUser(user) });
  });
  app.use('/api/auth', auth);

  // ---------- no account needed: feedback, crash reports, announcements
  app.use('/api/public', publicRoutes({ limiter }));

  // ---------- admin panel (static page + API, off unless ADMIN_TOKEN is set)
  app.use('/api/admin', adminRoutes({ limiter }));
  app.use('/admin', (_req, res, next) => (config.adminToken ? next() : res.status(404).json({ error: 'Not found' })),
    express.static(path.join(__dirname, '../admin'), { index: 'index.html', maxAge: 0 }));


  const api = express.Router();
  api.use(limiter(600, 15 * 60_000));
  api.use(requireAuth);

  // ---------- account
  api.get('/me', (req, res) => res.json({ user: publicUser(req.user) }));
  api.patch('/me/preferences', validate(schemas.preferences), async (req, res) => {
    const set = Object.fromEntries(Object.entries(req.valid).map(([k, v]) => [`preferences.${k}`, v]));
    const user = await User.findByIdAndUpdate(req.userId, { $set: set }, { returnDocument: 'after' }).lean();
    res.json({ user: publicUser(user) });
  });
  api.get('/me/export', async (req, res) => {
    const tasks = await Task.find({ userId: req.userId }).lean();
    res.json({ exportedAt: new Date().toISOString(), user: publicUser(req.user), tasks: tasks.map(svc.toClient) });
  });
  api.delete('/me', async (req, res) => {
    await Task.deleteMany({ userId: req.userId });
    await ProcessedOp.deleteMany({ userId: req.userId });
    await User.deleteOne({ _id: req.userId });
    res.status(204).end();
  });

  // ---------- tasks
  api.get('/tasks', async (req, res) => {
    const filter = { userId: req.userId, deletedAt: null };
    if (['PENDING', 'COMPLETED', 'CANCELLED'].includes(req.query.status)) filter.status = req.query.status;
    const tasks = await Task.find(filter).sort({ nextOccurrenceAt: 1, dueAt: 1 }).limit(1000).lean();
    res.json({ tasks: tasks.map(svc.toClient) });
  });
  api.get('/tasks/:id', async (req, res) => {
    res.json({ task: svc.toClient(await svc.getOwned(req.userId, req.params.id)) });
  });
  api.post('/tasks', async (req, res) => {
    const result = await svc.applyChange(req.userId, 'upsert', req.body);
    if (result.status === 'rejected') throw new HttpError(400, result.error);
    res.status(result.status === 'applied' ? 201 : 409).json(result);
  });
  api.put('/tasks/:id', validate(schemas.update), async (req, res) => {
    const current = await svc.getOwned(req.userId, req.params.id);
    if (req.valid.expectedVersion != null && req.valid.expectedVersion !== current.version) {
      throw new HttpError(409, 'Task was changed on another device', { task: svc.toClient(current) });
    }
    const result = await svc.applyChange(req.userId, 'upsert', { ...req.valid.task, id: req.params.id });
    if (result.status === 'rejected') throw new HttpError(400, result.error);
    res.status(result.status === 'applied' ? 200 : 409).json(result);
  });
  api.delete('/tasks/:id', async (req, res) => {
    await svc.getOwned(req.userId, req.params.id);
    const result = await svc.applyChange(req.userId, 'delete', { id: req.params.id, deletedAt: new Date().toISOString() });
    res.json(result);
  });
  api.post('/tasks/:id/complete', async (req, res) => {
    res.json({ task: await svc.completeOccurrence(req.userId, req.params.id) });
  });
  api.post('/tasks/:id/snooze', validate(schemas.snooze), async (req, res) => {
    res.json({ task: await svc.snooze(req.userId, req.params.id, req.valid.minutes) });
  });

  // ---------- sync
  api.post('/sync/push', validate(schemas.push), async (req, res) => {
    res.json({ results: await svc.applyOps(req.userId, req.valid.ops) });
  });
  api.get('/sync/changes', validate(schemas.changes, 'query'), async (req, res) => {
    res.json(await svc.changesSince(req.userId, req.valid.since, req.valid.limit));
  });

  app.use('/api', api);
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
