const path = require('path');
const dotenv = require('dotenv');

// Check server/.env relative to __dirname first, and allow process.cwd() to augment
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config();

const env = process.env.NODE_ENV || 'development';

const config = {
  env,
  port: Number(process.env.PORT) || 4000,
  mongoUri: process.env.MONGODB_URI,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '30d',
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS) || 12,
  trustProxy: process.env.TRUST_PROXY === '1',
  // Admin panel (/admin) secret. Unset = admin panel and API disabled.
  adminToken: process.env.ADMIN_TOKEN || '',
};

function assertConfig() {
  const problems = [];
  if (!config.mongoUri) problems.push('MONGODB_URI is required');
  if (!config.jwtSecret || config.jwtSecret.length < 32) problems.push('JWT_SECRET must be at least 32 characters');
  if (config.adminToken && config.adminToken.length < 24) problems.push('ADMIN_TOKEN must be at least 24 characters (or unset to disable the admin panel)');
  if (problems.length) throw new Error(`Invalid server configuration:\n - ${problems.join('\n - ')}`);
}

module.exports = { config, assertConfig };
