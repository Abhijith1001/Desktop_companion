// Endpoints the desktop app calls without an account: feedback, opt-in crash
// reports and announcements. Rate limited and size-capped; nothing here is
// trusted beyond being stored and shown to the admin as plain text.
const crypto = require('crypto');
const express = require('express');
const { z } = require('zod');
const { Feedback, Crash, Announcement } = require('../models/community');
const { validate } = require('../middleware');

const meta = { appVersion: z.string().max(40).default(''), os: z.string().max(80).default('') };

const feedbackInput = z.object({
  kind: z.enum(['idea', 'bug', 'love', 'other']).default('other'),
  message: z.string().trim().min(3).max(4000),
  email: z.union([z.string().trim().email().max(200), z.literal('')]).default(''),
  ...meta,
}).strip();

const crashInput = z.object({
  source: z.enum(['main', 'renderer', 'pet']).default('main'),
  message: z.string().max(1000).default(''),
  stack: z.string().max(8000).default(''),
  ...meta,
}).strip();

// Same error in the same version → same group. Line/column numbers are kept
// (they identify the place); user paths are stripped so groups merge across PCs.
const scrub = (s) => s.replace(/[A-Z]:\\Users\\[^\\]+/gi, '%USER%').replace(/\/Users\/[^/]+|\/home\/[^/]+/g, '%USER%');
const fingerprint = (c) => crypto.createHash('sha256')
  .update(`${c.source}|${c.appVersion}|${c.message}|${c.stack.split('\n').slice(0, 4).join('|')}`)
  .digest('hex');

function publicRoutes({ limiter }) {
  const r = express.Router();

  r.post('/feedback', limiter(10, 60 * 60_000), validate(feedbackInput), async (req, res) => {
    const f = await Feedback.create(req.valid);
    res.status(201).json({ id: String(f._id) });
  });

  r.post('/crash', limiter(30, 60 * 60_000), validate(crashInput), async (req, res) => {
    const c = { ...req.valid, message: scrub(req.valid.message), stack: scrub(req.valid.stack) };
    const now = new Date();
    await Crash.updateOne(
      { fingerprint: fingerprint(c) },
      { $setOnInsert: { ...c, firstAt: now }, $inc: { count: 1 }, $set: { lastAt: now, resolved: false } },
      { upsert: true },
    );
    res.status(202).json({ ok: true });
  });

  r.get('/announcements', limiter(120, 60 * 60_000), async (_req, res) => {
    const now = new Date();
    const list = await Announcement.find({
      active: true,
      $and: [
        { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
        { $or: [{ endsAt: null }, { endsAt: { $gt: now } }] },
      ],
    }).sort({ createdAt: -1 }).limit(5).lean();
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ announcements: list.map((a) => ({ id: String(a._id), title: a.title, body: a.body, link: a.link, createdAt: a.createdAt })) });
  });

  return r;
}

module.exports = { publicRoutes, fingerprint };
