// Live agent tracking. The agent's phone sends its position while the agent is "on duty" and inside working hours;
// the owner sees the latest position of every agent (and a day trail) on a map.
const router = require('express').Router();
const { z } = require('zod');
const cfg = require('../config');
const { query } = require('../db');
const { HttpError, wrap, camelAll } = require('../utils/http');
const { validate } = require('../middleware/validate');
const { protect, adminOnly } = require('../middleware/auth');

const STALE_MS = 3 * 60 * 1000; // no ping for 3 minutes while on duty -> "signal lost"

/** Current HH:MM in the shop's timezone. */
function nowHHMM(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: cfg.timezone, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date);
  const h = parts.find((p) => p.type === 'hour').value.replace('24', '00');
  return `${h}:${parts.find((p) => p.type === 'minute').value}`;
}
const todayStr = () => new Intl.DateTimeFormat('en-CA', { timeZone: cfg.timezone }).format(new Date()); // YYYY-MM-DD

async function workHours(user) {
  if (user.work_start && user.work_end) return { start: user.work_start, end: user.work_end };
  const s = (await query('SELECT work_start, work_end FROM settings WHERE id = 1')).rows[0] || {};
  return { start: s.work_start || '09:00', end: s.work_end || '18:00' };
}
const withinHours = (h, hhmm) => hhmm >= h.start && hhmm <= h.end;

const agentOnly = (req, res, next) => (req.user.role === 'AGENT' ? next() : next(new HttpError(403, 'Only agents can share their location', 'FORBIDDEN')));

// ─── agent side ──────────────────────────────────────────────────────
router.get(
  '/me',
  ...protect,
  agentOnly,
  wrap(async (req, res) => {
    const h = await workHours(req.user);
    res.json({ onDuty: req.user.on_duty, onDutySince: req.user.on_duty_since, workStart: h.start, workEnd: h.end, withinHours: withinHours(h, nowHHMM()) });
  })
);

router.post(
  '/duty',
  ...protect,
  agentOnly,
  validate(z.object({ on: z.boolean() })),
  wrap(async (req, res) => {
    const { on } = req.valid.body;
    const h = await workHours(req.user);
    if (on && !withinHours(h, nowHHMM())) {
      throw new HttpError(400, `Duty can start only in your working hours (${h.start} - ${h.end})`, 'OFF_HOURS');
    }
    await query('UPDATE users SET on_duty = $1, on_duty_since = CASE WHEN $1 THEN now() ELSE NULL END WHERE id = $2', [on, req.user.id]);
    res.json({ onDuty: on, workStart: h.start, workEnd: h.end });
  })
);

const pingSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  accuracy: z.coerce.number().min(0).max(100000).optional(),
  speed: z.coerce.number().min(0).max(500).optional().nullable(),
  battery: z.coerce.number().min(0).max(100).optional().nullable(),
});

router.post(
  '/ping',
  ...protect,
  agentOnly,
  validate(pingSchema),
  wrap(async (req, res) => {
    if (!req.user.on_duty) return res.json({ saved: false, reason: 'OFF_DUTY' });
    const h = await workHours(req.user);
    if (!withinHours(h, nowHHMM())) {
      // working day is over: switch duty off so tracking really stops
      await query('UPDATE users SET on_duty = FALSE, on_duty_since = NULL WHERE id = $1', [req.user.id]);
      return res.json({ saved: false, reason: 'OFF_HOURS' });
    }
    const last = (await query('SELECT created_at FROM location_pings WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [req.user.id])).rows[0];
    if (last && Date.now() - new Date(last.created_at).getTime() < 4000) return res.json({ saved: false, reason: 'TOO_FAST' });
    const b = req.valid.body;
    await query('INSERT INTO location_pings (user_id, lat, lng, accuracy, speed, battery) VALUES ($1,$2,$3,$4,$5,$6)', [
      req.user.id, b.lat, b.lng, b.accuracy ?? null, b.speed ?? null, b.battery ?? null,
    ]);
    res.json({ saved: true });
  })
);

// ─── owner side ──────────────────────────────────────────────────────
router.get(
  '/live',
  ...adminOnly,
  wrap(async (req, res) => {
    const { rows } = await query(
      `SELECT u.id, u.name, u.phone, u.on_duty, u.on_duty_since, u.work_start, u.work_end,
              lp.lat, lp.lng, lp.accuracy, lp.battery, lp.speed, lp.created_at AS last_seen
         FROM users u
         LEFT JOIN LATERAL (SELECT * FROM location_pings p WHERE p.user_id = u.id ORDER BY p.id DESC LIMIT 1) lp ON TRUE
        WHERE u.role = 'AGENT' AND u.is_active ORDER BY u.on_duty DESC, lower(u.name)`
    );
    const now = Date.now();
    const items = camelAll(rows).map((a) => {
      const age = a.lastSeen ? now - new Date(a.lastSeen).getTime() : null;
      let status = 'OFF';
      if (a.onDuty) status = age !== null && age <= STALE_MS ? 'LIVE' : 'NO_SIGNAL';
      return { ...a, status, secondsAgo: age === null ? null : Math.round(age / 1000) };
    });
    res.json({ items, serverTime: new Date().toISOString() });
  })
);

router.get(
  '/trail/:agentId',
  ...adminOnly,
  validate(z.object({ agentId: z.coerce.number().int().positive() }), 'params'),
  validate(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), 'query'),
  wrap(async (req, res) => {
    const date = req.valid.query.date || todayStr();
    const { rows } = await query(
      `SELECT lat, lng, accuracy, created_at FROM location_pings
        WHERE user_id = $1 AND (created_at AT TIME ZONE $2)::date = $3::date ORDER BY id ASC LIMIT 3000`,
      [req.valid.params.agentId, cfg.timezone, date]
    );
    res.json({ date, items: camelAll(rows) });
  })
);

module.exports = router;
