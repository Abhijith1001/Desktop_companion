// Admin API behind a single shared secret (ADMIN_TOKEN). Used by the admin
// panel at /admin. Disabled entirely when ADMIN_TOKEN is not set.
const crypto = require('crypto');
const express = require('express');
const mongoose = require('mongoose');
const { z } = require('zod');
const { config } = require('../config');
const { User, Task, ProcessedOp } = require('../models');
const { Feedback, Crash, Announcement } = require('../models/community');
const { validate } = require('../middleware');
const { HttpError } = require('../services/taskService');

const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();

function requireAdmin(req, _res, next) {
  if (!config.adminToken) throw new HttpError(404, 'Not found');
  const header = req.get('authorization') || '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!given || !crypto.timingSafeEqual(digest(given), digest(config.adminToken))) throw new HttpError(401, 'Wrong admin token');
  next();
}

const objectId = (id) => {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'Not found');
  return id;
};
const page = (q) => ({ limit: Math.min(Number(q.limit) || 50, 200), skip: Math.max(Number(q.skip) || 0, 0) });
const optionalDate = z.union([z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'Invalid date'), z.null()]).optional();
const announcementInput = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().max(1000).default(''),
  link: z.string().max(500).refine((s) => s === '' || /^https:\/\//i.test(s), 'Link must start with https://').default(''),
  active: z.boolean().default(true),
  startsAt: optionalDate,
  endsAt: optionalDate,
}).strip();

function adminRoutes({ limiter }) {
  const r = express.Router();
  r.use(limiter(300, 15 * 60_000));
  r.use(requireAdmin);

  r.get('/stats', async (_req, res) => {
    const weekAgo = new Date(Date.now() - 7 * 86_400_000);
    const [users, newUsers, activeUsers, tasks, feedbackNew, crashesOpen, crashEvents] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ createdAt: { $gte: weekAgo } }),
      Task.distinct('userId', { serverUpdatedAt: { $gte: weekAgo } }).then((ids) => ids.length),
      Task.countDocuments({ deletedAt: null }),
      Feedback.countDocuments({ status: 'new' }),
      Crash.countDocuments({ resolved: false }),
      Crash.aggregate([{ $match: { lastAt: { $gte: weekAgo } } }, { $group: { _id: null, n: { $sum: '$count' } } }]).then((a) => a[0]?.n || 0),
    ]);
    const characters = await User.aggregate([{ $group: { _id: '$preferences.character', n: { $sum: 1 } } }, { $sort: { n: -1 } }]);
    res.json({ users, newUsers, activeUsers, tasks, feedbackNew, crashesOpen, crashEvents, characters: characters.map((c) => ({ id: c._id || 'unknown', n: c.n })) });
  });

  // ---------- users
  r.get('/users', async (req, res) => {
    const { limit, skip } = page(req.query);
    const q = typeof req.query.q === 'string' && req.query.q.trim()
      ? { email: { $regex: req.query.q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } } : {};
    const [list, total] = await Promise.all([
      User.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      User.countDocuments(q),
    ]);
    const counts = await Task.aggregate([
      { $match: { userId: { $in: list.map((u) => u._id) }, deletedAt: null } },
      { $group: { _id: '$userId', n: { $sum: 1 }, last: { $max: '$serverUpdatedAt' } } },
    ]);
    const byUser = new Map(counts.map((c) => [String(c._id), c]));
    res.json({
      total,
      users: list.map((u) => ({
        id: String(u._id), email: u.email, character: u.preferences?.character, createdAt: u.createdAt,
        tasks: byUser.get(String(u._id))?.n || 0, lastSyncAt: byUser.get(String(u._id))?.last || null,
      })),
    });
  });
  r.delete('/users/:id', async (req, res) => {
    const id = objectId(req.params.id);
    await Task.deleteMany({ userId: id });
    await ProcessedOp.deleteMany({ userId: id });
    const { deletedCount } = await User.deleteOne({ _id: id });
    if (!deletedCount) throw new HttpError(404, 'User not found');
    res.status(204).end();
  });

  // ---------- feedback
  r.get('/feedback', async (req, res) => {
    const { limit, skip } = page(req.query);
    const q = ['new', 'read', 'done'].includes(req.query.status) ? { status: req.query.status } : {};
    const [list, total] = await Promise.all([Feedback.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), Feedback.countDocuments(q)]);
    res.json({ total, feedback: list.map(({ _id, ...f }) => ({ id: String(_id), ...f })) });
  });
  r.patch('/feedback/:id', validate(z.object({ status: z.enum(['new', 'read', 'done']) })), async (req, res) => {
    const f = await Feedback.findByIdAndUpdate(objectId(req.params.id), { status: req.valid.status }, { returnDocument: 'after' }).lean();
    if (!f) throw new HttpError(404, 'Not found');
    res.json({ ok: true });
  });
  r.delete('/feedback/:id', async (req, res) => {
    await Feedback.deleteOne({ _id: objectId(req.params.id) });
    res.status(204).end();
  });

  // ---------- crashes
  r.get('/crashes', async (req, res) => {
    const { limit, skip } = page(req.query);
    const q = req.query.resolved === 'true' ? { resolved: true } : req.query.resolved === 'all' ? {} : { resolved: false };
    const [list, total] = await Promise.all([Crash.find(q).sort({ lastAt: -1 }).skip(skip).limit(limit).lean(), Crash.countDocuments(q)]);
    res.json({ total, crashes: list.map(({ _id, fingerprint, ...c }) => ({ id: String(_id), ...c })) });
  });
  r.patch('/crashes/:id', validate(z.object({ resolved: z.boolean() })), async (req, res) => {
    await Crash.updateOne({ _id: objectId(req.params.id) }, { resolved: req.valid.resolved });
    res.json({ ok: true });
  });
  r.delete('/crashes/:id', async (req, res) => {
    await Crash.deleteOne({ _id: objectId(req.params.id) });
    res.status(204).end();
  });

  // ---------- announcements
  const toDate = (v) => (v ? new Date(v) : null);
  const withDates = (a) => ({ ...a, startsAt: toDate(a.startsAt), endsAt: toDate(a.endsAt) });
  r.get('/announcements', async (_req, res) => {
    const list = await Announcement.find().sort({ createdAt: -1 }).limit(100).lean();
    res.json({ announcements: list.map(({ _id, ...a }) => ({ id: String(_id), ...a })) });
  });
  r.post('/announcements', validate(announcementInput), async (req, res) => {
    const a = await Announcement.create(withDates(req.valid));
    res.status(201).json({ id: String(a._id) });
  });
  r.put('/announcements/:id', validate(announcementInput), async (req, res) => {
    const a = await Announcement.findByIdAndUpdate(objectId(req.params.id), withDates(req.valid), { returnDocument: 'after' }).lean();
    if (!a) throw new HttpError(404, 'Not found');
    res.json({ ok: true });
  });
  r.delete('/announcements/:id', async (req, res) => {
    await Announcement.deleteOne({ _id: objectId(req.params.id) });
    res.status(204).end();
  });

  return r;
}

module.exports = { adminRoutes };
