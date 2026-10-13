const jwt = require('jsonwebtoken');
const { z } = require('zod');
const { config } = require('../config');
const { User } = require('../models');
const { HttpError } = require('../services/taskService');
const log = require('../logger');

// The user id always comes from the verified token, never from the request body.
async function requireAuth(req, _res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new HttpError(401, 'Sign in required');
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    throw new HttpError(401, 'Session expired, please sign in again');
  }
  const user = await User.findById(payload.sub).lean();
  if (!user) throw new HttpError(401, 'Account not found');
  req.user = user;
  req.userId = user._id;
  next();
}

const validate = (schema, source = 'body') => (req, _res, next) => {
  const r = schema.safeParse(req[source]);
  if (!r.success) {
    const issue = r.error.issues[0];
    throw new HttpError(400, issue ? `${issue.path.join('.') || source}: ${issue.message}` : 'Invalid request');
  }
  req.valid = r.data;
  next();
};

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
  if (err instanceof z.ZodError) return res.status(400).json({ error: 'Invalid request' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' });
  log.error('unhandled error', { path: req.path, method: req.method, error: err.message, stack: err.stack });
  return res.status(500).json({ error: 'Internal server error' });
}

module.exports = { requireAuth, validate, errorHandler };
