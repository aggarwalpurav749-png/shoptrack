const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const cfg = require('./config');
const { query, migrate, pool } = require('./db');
const { notFound, errorHandler } = require('./middleware/errors');
const { hashPassword } = require('./utils/password');
const { INTERNAL_SECRET } = require('./utils/internal');

const app = express();
app.set('trust proxy', 1); // Render / most hosts sit behind a proxy

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // product photos are shown from other origins
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'img-src': ["'self'", 'data:', 'blob:', 'https:'],
        'upgrade-insecure-requests': null, // would break http://localhost on Termux
      },
    },
  })
);
// Login uses a bearer token (no cookies), so open CORS is safe; set CORS_ORIGIN to lock it to your site.
app.use(cors({ origin: cfg.corsOrigins.length ? cfg.corsOrigins : true }));
app.use(express.json({ limit: '6mb' }));

app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: 400, skip: (req) => req.headers['x-internal-sync'] === INTERNAL_SECRET, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests. Slow down a little.', code: 'RATE_LIMIT' } }));

app.get('/api/health', async (req, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true, time: new Date().toISOString() });
  } catch (e) {
    res.status(503).json({ ok: false, error: 'Database not reachable' });
  }
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/agents', require('./routes/agents'));
app.use('/api/parties', require('./routes/parties'));
app.use('/api/products', require('./routes/products'));
app.use('/api/images', require('./routes/imageSearch'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/invoices', require('./routes/invoices'));
app.use('/api/tracking', require('./routes/tracking'));
app.use('/api/sync', require('./routes/sync'));
app.use('/api', notFound);

// Locally stored photos (used when Cloudinary keys are not set)
app.use('/uploads', express.static(cfg.uploadDir, { maxAge: '7d', index: false, fallthrough: false }));

// Serve the built React app from the same server (one process, one port)
const indexHtml = path.join(cfg.clientDist, 'index.html');
if (fs.existsSync(indexHtml)) {
  app.use(
    express.static(cfg.clientDist, {
      index: false,
      setHeaders(res, filePath) {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        else res.setHeader('Cache-Control', 'no-cache'); // index.html, sw.js, manifest: always revalidate
      },
    })
  );
  app.get(/^\/(?!api\/|uploads\/).*/, (req, res) => res.sendFile(indexHtml));
} else {
  app.get('/', (req, res) => res.json({ name: 'ShopTrack API', ok: true, hint: 'Client build not found. Run "npm run build" at the project root, or start the Vite dev server.' }));
}

app.use(errorHandler);

/** First run: make sure the settings row and an owner login exist. */
async function bootstrap() {
  await query('INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
  const { rows } = await query('SELECT count(*)::int AS n FROM users');
  if (rows[0].n === 0) {
    const hash = await hashPassword(cfg.adminPassword);
    await query(
      `INSERT INTO users (email, password_hash, name, role, must_change_password) VALUES ($1, $2, $3, 'ADMIN', TRUE)`,
      [cfg.adminEmail, hash, cfg.adminName]
    );
    console.log(`[setup] Owner account created: ${cfg.adminEmail} (you must change the password at first login)`);
  }
  // location history older than 30 days is not needed
  query("DELETE FROM location_pings WHERE created_at < now() - interval '30 days'").catch(() => {});
  if (cfg.seedDemo) {
    const { seedDemo } = require('../db/seed');
    await seedDemo();
  }
}

async function start() {
  await migrate();
  await bootstrap();
  const server = app.listen(cfg.port, '0.0.0.0', () => {
    console.log(`[server] ShopTrack running on http://localhost:${cfg.port}  (${cfg.env})`);
  });
  const shutdown = () => {
    server.close(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch((err) => {
  console.error('[server] Could not start:', err.message);
  if (/ECONNREFUSED|ENOTFOUND|timeout|password|SSL|ssl/i.test(err.message)) {
    console.error('        -> Check DATABASE_URL in server/.env (see README, "Database" step).');
  }
  process.exit(1);
});
