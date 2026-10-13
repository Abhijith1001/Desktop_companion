const mongoose = require('mongoose');
const { config, assertConfig } = require('./config');
const { connectWithRetry } = require('./db');
const { createApp } = require('./app');
const log = require('./logger');

async function main() {
  assertConfig();
  await connectWithRetry(config.mongoUri);
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));

  const server = createApp().listen(config.port, () => log.info('desktop buddy api listening', { port: config.port, env: config.env }));

  const shutdown = (signal) => {
    log.info('shutting down', { signal });
    server.close(async () => {
      await mongoose.disconnect();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  log.error('failed to start', { error: err.message });
  process.exit(1);
});
