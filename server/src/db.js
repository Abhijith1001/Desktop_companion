const mongoose = require('mongoose');
const log = require('./logger');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Exponential backoff with full jitter: 0.5s, 1s, 2s … capped at 30s.
async function connectWithRetry(uri, { maxAttempts = Infinity, baseMs = 500, capMs = 30_000 } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      await mongoose.connect(uri, { maxPoolSize: 10, serverSelectionTimeoutMS: 5000 });
      log.info('mongodb connected');
      return mongoose.connection;
    } catch (err) {
      if (attempt >= maxAttempts) throw err;
      const delay = Math.random() * Math.min(capMs, baseMs * 2 ** (attempt - 1));
      log.warn('mongodb connection failed, retrying', { attempt, delayMs: Math.round(delay), error: err.message });
      await sleep(delay);
    }
  }
}

mongoose.connection.on('disconnected', () => log.warn('mongodb disconnected'));
mongoose.connection.on('reconnected', () => log.info('mongodb reconnected'));

const isHealthy = () => mongoose.connection.readyState === 1;

module.exports = { connectWithRetry, isHealthy };
