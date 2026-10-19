const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const env = process.env.NODE_ENV || 'development';
const isProd = env === 'production';

let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 16 || /replace-me|change_this/i.test(jwtSecret)) {
  if (isProd) {
    throw new Error('JWT_SECRET is missing or too weak. Set a random value of at least 16 characters.');
  }
  jwtSecret = 'dev-only-secret-do-not-use-in-production';
  console.warn('[config] JWT_SECRET not set - using an insecure development secret.');
}

const list = (v) =>
  (v || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

module.exports = {
  env,
  isProd,
  port: Number(process.env.PORT) || 5000,
  databaseUrl: process.env.DATABASE_URL || '',
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '30d',
  corsOrigins: list(process.env.CORS_ORIGIN),
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
  },
  timezone: process.env.APP_TZ || 'Asia/Kolkata', // working hours are checked in this timezone
  pexelsKey: process.env.PEXELS_API_KEY || '',
  pixabayKey: process.env.PIXABAY_API_KEY || '',
  adminEmail: (process.env.ADMIN_EMAIL || 'admin@shop.com').toLowerCase(),
  adminPassword: process.env.ADMIN_PASSWORD || 'Admin@123',
  adminName: process.env.ADMIN_NAME || 'Owner',
  seedDemo: String(process.env.SEED_DEMO || '').toLowerCase() === 'true',
  uploadDir: process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'),
  clientDist: path.join(__dirname, '..', '..', 'client', 'dist'),
};
