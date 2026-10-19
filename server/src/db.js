// PostgreSQL via plain `pg` (no ORM): runs on Termux, Neon, Render and any Postgres.
const fs = require('fs');
const path = require('path');
const { Pool, types } = require('pg');
const cfg = require('./config');

// numeric -> JS number, bigint (count) -> JS number
types.setTypeParser(1700, (v) => parseFloat(v));
types.setTypeParser(20, (v) => parseInt(v, 10));

function connectionConfig() {
  const raw = cfg.databaseUrl;
  if (!raw) {
    console.error('[db] DATABASE_URL is not set. Copy server/.env.example to server/.env and fill it in.');
    process.exit(1);
  }
  let connectionString = raw;
  let ssl;
  try {
    const u = new URL(raw);
    const mode = u.searchParams.get('sslmode');
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
    if (mode && mode !== 'disable') ssl = { rejectUnauthorized: false }; // Neon / Render need SSL
    else if (!mode && !local && cfg.isProd) ssl = { rejectUnauthorized: false };
    // SSL is passed explicitly, so strip it from the URL (newer pg versions treat sslmode strictly)
    u.searchParams.delete('sslmode');
    u.searchParams.delete('channel_binding');
    connectionString = u.toString();
  } catch (e) {
    /* not a URL pg can parse; hand it over unchanged */
  }
  return { connectionString, ssl };
}

const pool = new Pool({
  ...connectionConfig(),
  max: 8,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 20000, // Neon may need a few seconds to wake up
});
pool.on('error', (e) => console.error('[db] idle client error:', e.message));

const query = (text, params) => pool.query(text, params);

/** tx(async (client) => { ... })  - commits on success, rolls back on any error. */
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }
}

/** Creates / updates all tables. Safe to run on every start (everything is IF NOT EXISTS). */
async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await pool.query(sql);
}

module.exports = { pool, query, tx, migrate };
