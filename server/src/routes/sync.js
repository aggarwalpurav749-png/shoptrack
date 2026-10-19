// Sync for the offline apps (Android / Windows).
//   GET  /pull    everything that changed since the device last synced (only what this user may see)
//   POST /push    changes the device made offline, replayed in order through the normal API (same checks, same rules)
//   POST /pings   GPS points + events recorded offline
//   POST /blocks  a range of order / estimate numbers to use offline
const http = require('http');
const router = require('express').Router();
const { z } = require('zod');
const cfg = require('../config');
const { query, tx } = require('../db');
const { HttpError, wrap, camel, camelAll } = require('../utils/http');
const { validate } = require('../middleware/validate');
const { protect } = require('../middleware/auth');
const { reserveBlock } = require('../utils/numbers');
const { INTERNAL_SECRET } = require('../utils/internal');
const { remapIds, remapPath, hasTempId, createdId, isAllowedOp } = require('../utils/syncRemap');
const { hhmmAt, withinHours } = require('../utils/clock');

const isAdminReq = (req) => req.user.role === 'ADMIN';
const iso = (d) => new Date(d).toISOString();

const USER_COLS = `u.id, u.email, u.name, u.phone, u.role, u.is_active, u.must_change_password, u.work_start, u.work_end,
                   u.on_duty, u.on_duty_since, u.created_at, u.updated_at`;

// ─── pull ────────────────────────────────────────────────────────────
router.get(
  '/pull',
  ...protect,
  validate(z.object({ since: z.string().max(40).optional() }), 'query'),
  wrap(async (req, res) => {
    const admin = isAdminReq(req);
    const sinceDate = req.valid.query.since ? new Date(req.valid.query.since) : new Date(0);
    if (Number.isNaN(sinceDate.getTime())) throw new HttpError(400, 'Bad date', 'VALIDATION');
    const since = sinceDate.toISOString();
    const serverTime = iso((await query('SELECT now() AS t')).rows[0].t);

    const partyWhere = 'p.updated_at > $1'; // agents get every party too (they can take an order for anyone)
    const orderWhere = admin ? 'o.updated_at > $1' : 'o.updated_at > $1 AND o.agent_id = $2';
    const own = admin ? [since] : [since, req.user.id];

    const productCols = `p.id, p.name, p.sku, p.category, p.brand, p.unit, p.mrp, p.selling_price, ${admin ? 'p.cost_price,' : ''}
      p.gst_percent, p.hsn, p.stock_qty, p.low_stock_level, p.description, p.is_archived, p.deleted_at, p.created_at, p.updated_at,
      (SELECT coalesce(json_agg(json_build_object('id', i.id, 'url', i.url, 'isPrimary', i.is_primary, 'storage', i.storage, 'createdAt', i.created_at)
                               ORDER BY i.is_primary DESC, i.id), '[]'::json) FROM product_images i WHERE i.product_id = p.id) AS images`;

    const jobs = [
      query(`SELECT p.* FROM parties p WHERE ${partyWhere} ORDER BY p.id LIMIT 50000`, [since]),
      query(`SELECT ${productCols} FROM products p WHERE p.updated_at > $1 ORDER BY p.id LIMIT 50000`, [since]),
      query(
        `SELECT o.*, (SELECT coalesce(json_agg(json_build_object('id', oi.id, 'productId', oi.product_id, 'qty', oi.qty, 'rate', oi.rate,
                         'discount', oi.discount, 'gstPercent', oi.gst_percent, 'lineTotal', oi.line_total) ORDER BY oi.id), '[]'::json)
                        FROM order_items oi WHERE oi.order_id = o.id) AS items
           FROM orders o WHERE ${orderWhere} ORDER BY o.id LIMIT 50000`,
        own
      ),
      query('SELECT shop_name, logo_url, address, phone, email, bank_name, account_no, ifsc, upi_id, invoice_prefix, next_invoice_no, work_start, work_end, default_gst_percent, terms FROM settings WHERE id = 1'),
      admin
        ? query(`SELECT ${USER_COLS} FROM users u WHERE u.updated_at > $1 AND (u.role = 'AGENT' OR u.id = $2)`, [since, req.user.id])
        : query(`SELECT ${USER_COLS} FROM users u WHERE u.id = $1`, [req.user.id]),
    ];
    if (admin) {
      jobs.push(
        query(
          `SELECT i.*, (SELECT coalesce(json_agg(json_build_object('id', ii.id, 'productId', ii.product_id, 'name', ii.name, 'hsn', ii.hsn, 'unit', ii.unit,
                           'qty', ii.qty, 'rate', ii.rate, 'discount', ii.discount, 'gstPercent', ii.gst_percent, 'taxable', ii.taxable, 'tax', ii.tax,
                           'lineTotal', ii.line_total) ORDER BY ii.id), '[]'::json) FROM invoice_items ii WHERE ii.invoice_id = i.id) AS items
             FROM invoices i WHERE i.updated_at > $1 ORDER BY i.id LIMIT 50000`,
          [since]
        ),
        query(
          `SELECT u.id, u.name, u.phone, u.on_duty, u.on_duty_since, u.work_start, u.work_end,
                  lp.lat, lp.lng, lp.accuracy, lp.battery, lp.speed, lp.created_at AS last_seen,
                  (SELECT e.kind FROM agent_events e WHERE e.user_id = u.id AND e.kind IN ('GPS_OFF', 'GPS_ON') ORDER BY e.at DESC LIMIT 1) AS last_gps_event,
                  (SELECT e.at FROM agent_events e WHERE e.user_id = u.id AND e.kind IN ('GPS_OFF', 'GPS_ON') ORDER BY e.at DESC LIMIT 1) AS last_gps_event_at
             FROM users u
             LEFT JOIN LATERAL (SELECT * FROM location_pings p WHERE p.user_id = u.id ORDER BY p.created_at DESC LIMIT 1) lp ON TRUE
            WHERE u.role = 'AGENT' AND u.is_active`
        )
      );
    }

    const [parties, products, orders, settings, users, extraA, extraB] = await Promise.all(jobs);
    res.json({
      serverTime,
      timezone: cfg.timezone,
      parties: camelAll(parties.rows),
      products: camelAll(products.rows),
      orders: camelAll(orders.rows),
      settings: camel(settings.rows[0]),
      users: camelAll(users.rows),
      invoices: admin ? camelAll(extraA.rows) : [],
      live: admin ? camelAll(extraB.rows) : null,
      visiblePartyIds: null,
    });
  })
);

// ─── push ────────────────────────────────────────────────────────────
const opSchema = z.object({
  id: z.string().min(8).max(64),
  method: z.enum(['POST', 'PUT', 'PATCH', 'DELETE']),
  path: z.string().max(200),
  body: z.any().optional(),
  tempId: z.number().optional(),
});
const pushSchema = z.object({ ops: z.array(opSchema).min(1).max(100) });

function callSelf(req, op) {
  return new Promise((resolve) => {
    const payload = op.body === undefined || op.body === null ? null : JSON.stringify(op.body);
    const headers = { 'Content-Type': 'application/json', Authorization: req.headers.authorization, 'X-Internal-Sync': INTERNAL_SECRET };
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
    const r = http.request({ host: '127.0.0.1', port: req.socket.localPort, path: '/api' + op.path, method: op.method, headers, timeout: 40000 }, (resp) => {
      let buf = '';
      resp.on('data', (c) => (buf += c));
      resp.on('end', () => {
        let data = null;
        try {
          data = JSON.parse(buf);
        } catch (e) {
          /* not json */
        }
        resolve({ status: resp.statusCode, data });
      });
    });
    r.on('timeout', () => r.destroy(new Error('timeout')));
    r.on('error', (e) => resolve({ status: 0, data: { error: e.message } }));
    if (payload) r.write(payload);
    r.end();
  });
}

router.post(
  '/push',
  ...protect,
  validate(pushSchema),
  wrap(async (req, res) => {
    const map = new Map(); // temp id -> real id, filled while the changes are replayed in order
    const results = [];
    for (const op of req.valid.body.ops) {
      const fail = (status, error, code = 'SYNC') => results.push({ id: op.id, tempId: op.tempId, ok: false, status, error, code });
      if (!isAllowedOp(op.method, op.path.replace(/\/-\d+/g, '/-1'))) {
        fail(400, 'This kind of change cannot be synced', 'NOT_ALLOWED');
        continue;
      }
      const path = remapPath(op.path, map);
      const body = remapIds(op.body, map);
      if (hasTempId(path, body)) {
        fail(409, 'This depends on an earlier change that could not be saved', 'DEPENDENCY');
        continue;
      }

      // already done before (the phone lost the answer)? give the same answer again
      const claim = await query('INSERT INTO sync_ops (op_id, user_id) VALUES ($1, $2) ON CONFLICT (op_id) DO NOTHING RETURNING op_id', [op.id, req.user.id]);
      let status;
      let data;
      if (!claim.rowCount) {
        const prev = (await query('SELECT user_id, state, status, response FROM sync_ops WHERE op_id = $1', [op.id])).rows[0];
        if (!prev || prev.user_id !== req.user.id) {
          fail(409, 'Duplicate change id', 'DUPLICATE_OP');
          continue;
        }
        if (prev.state !== 'DONE') {
          fail(409, 'This change may already be saved. Please check the list and redo it if it is missing.', 'UNCERTAIN');
          continue;
        }
        status = prev.status;
        data = prev.response;
      } else {
        ({ status, data } = await callSelf(req, { method: op.method, path, body }));
        if (status === 0 || status >= 500) {
          // the server could not do it right now: forget the claim so the phone can try again later
          await query('DELETE FROM sync_ops WHERE op_id = $1', [op.id]);
          results.push({ id: op.id, tempId: op.tempId, ok: false, retry: true, status, error: (data && data.error) || 'Server busy' });
          break; // keep the order: do not run later changes before this one
        }
        await query("UPDATE sync_ops SET state = 'DONE', status = $2, response = $3 WHERE op_id = $1", [op.id, status, JSON.stringify(data || {})]);
      }

      if (status < 400) {
        const realId = createdId(op.method, path, data);
        if (op.tempId && realId) map.set(op.tempId, realId);
        results.push({ id: op.id, tempId: op.tempId, ok: true, status, realId: realId || null, warnings: data && data.negativeStock && data.negativeStock.length ? data.negativeStock : undefined });
      } else {
        results.push({ id: op.id, tempId: op.tempId, ok: false, status, error: (data && data.error) || 'Could not save this change', code: (data && data.code) || 'ERROR', fields: data && data.fields });
      }
    }
    // old receipts are not needed after a while
    query("DELETE FROM sync_ops WHERE created_at < now() - interval '45 days'").catch(() => {});
    res.json({ results });
  })
);

// ─── GPS points / events recorded offline ────────────────────────────
const pingsSchema = z.object({
  pings: z
    .array(
      z.object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        accuracy: z.number().min(0).max(100000).nullish(),
        speed: z.number().min(0).max(500).nullish(),
        battery: z.number().min(0).max(100).nullish(),
        at: z.string().max(40),
      })
    )
    .max(1500)
    .default([]),
  events: z.array(z.object({ kind: z.enum(['GPS_OFF', 'GPS_ON', 'DUTY_ON', 'DUTY_OFF', 'APP_OPEN']), at: z.string().max(40) })).max(300).default([]),
  duty: z.object({ on: z.boolean() }).optional(),
});

router.post(
  '/pings',
  ...protect,
  validate(pingsSchema),
  wrap(async (req, res) => {
    if (req.user.role !== 'AGENT') throw new HttpError(403, 'Only agents can share their location', 'FORBIDDEN');
    const b = req.valid.body;
    const s = (await query('SELECT work_start, work_end FROM settings WHERE id = 1')).rows[0] || {};
    const hours = { start: req.user.work_start || s.work_start || '09:00', end: req.user.work_end || s.work_end || '18:00' };
    const now = Date.now();
    const okTime = (at) => {
      const t = new Date(at).getTime();
      return Number.isFinite(t) && t <= now + 5 * 60000 && t >= now - 40 * 86400000 ? new Date(t) : null;
    };

    // location is kept only for points taken inside working hours
    const pts = b.pings.map((p) => ({ ...p, d: okTime(p.at) })).filter((p) => p.d && withinHours(hours, hhmmAt(p.d)));
    let saved = 0;
    if (pts.length) {
      const r = await query(
        `INSERT INTO location_pings (user_id, lat, lng, accuracy, speed, battery, created_at)
         SELECT $1, * FROM unnest($2::float8[], $3::float8[], $4::float8[], $5::float8[], $6::float8[], $7::timestamptz[])
         ON CONFLICT DO NOTHING`,
        [req.user.id, pts.map((p) => p.lat), pts.map((p) => p.lng), pts.map((p) => p.accuracy ?? null), pts.map((p) => p.speed ?? null), pts.map((p) => p.battery ?? null), pts.map((p) => p.d.toISOString())]
      );
      saved = r.rowCount;
    }
    const evs = b.events.map((e) => ({ ...e, d: okTime(e.at) })).filter((e) => e.d);
    if (evs.length) {
      await query(
        `INSERT INTO agent_events (user_id, kind, at) SELECT $1, * FROM unnest($2::text[], $3::timestamptz[]) ON CONFLICT DO NOTHING`,
        [req.user.id, evs.map((e) => e.kind), evs.map((e) => e.d.toISOString())]
      );
    }
    if (b.duty) {
      const on = b.duty.on && withinHours(hours, hhmmAt());
      await query('UPDATE users SET on_duty = $1, on_duty_since = CASE WHEN $1 THEN COALESCE(on_duty_since, now()) ELSE NULL END WHERE id = $2', [on, req.user.id]);
    }
    res.json({ saved, events: evs.length });
  })
);

// ─── number blocks ───────────────────────────────────────────────────
router.post(
  '/blocks',
  ...protect,
  validate(z.object({ kind: z.enum(['ORDER', 'INVOICE']), count: z.coerce.number().int().min(1).max(100).default(30) })),
  wrap(async (req, res) => {
    const { kind, count } = req.valid.body;
    if (kind === 'INVOICE' && req.user.role !== 'ADMIN') throw new HttpError(403, 'Only the owner makes estimates', 'FORBIDDEN');
    const block = await tx((client) => reserveBlock(client, req.user.id, kind, count));
    res.json(block);
  })
);

module.exports = router;
