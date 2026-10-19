// Orders: an agent takes an order at a retailer -> the owner sees it -> the owner turns it into an invoice.
const router = require('express').Router();
const { z } = require('zod');
const { query, tx } = require('../db');
const { HttpError, wrap, camel, camelAll, escapeLike } = require('../utils/http');
const { validate } = require('../middleware/validate');
const { protect, adminOnly } = require('../middleware/auth');
const { optText } = require('../utils/fields');
const { calcLines, r2 } = require('../utils/money');
const { numberPart, isReservedFor, sanePastDate } = require('../utils/numbers');

const STATUSES = ['PENDING', 'CONFIRMED', 'PACKED', 'DISPATCHED', 'DELIVERED', 'CANCELLED'];
const idParam = z.object({ id: z.coerce.number().int().positive() });

const itemShape = z.object({
  productId: z.coerce.number().int().positive(),
  qty: z.coerce.number({ invalid_type_error: 'Quantity must be a number' }).positive('Quantity must be more than 0').max(1e6),
  rate: z.coerce.number().min(0).max(1e9).optional(), // admin only
  discount: z.coerce.number().min(0).max(1e9).optional(), // admin only
});
const itemsField = z.array(itemShape).min(1, 'Add at least one product').max(150, 'Too many products in one order');

const createSchema = z.object({
  partyId: z.coerce.number().int().positive('Choose a party'),
  items: itemsField,
  notes: optText(500, 'Notes'),
  // sent by the offline apps: the number they gave the order while offline, and when it was really taken
  orderNo: z.string().regex(/^ORD-\d{5,9}$/).optional(),
  createdAt: z.string().max(40).optional(),
});
const editSchema = z.object({ items: itemsField, notes: optText(500, 'Notes') });
const statusSchema = z.object({ status: z.enum(STATUSES) });
const listSchema = z.object({
  status: z.enum(STATUSES).optional(),
  q: z.string().trim().max(100).optional(),
  agentId: z.coerce.number().int().positive().optional(),
  partyId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** Merge repeated products, load their current data, compute the totals. */
async function buildLines(client, items, { allowPriceEdit }) {
  const merged = new Map();
  for (const it of items) {
    const prev = merged.get(it.productId);
    if (prev) prev.qty = r2(prev.qty + it.qty);
    else merged.set(it.productId, { ...it });
  }
  const ids = [...merged.keys()];
  const { rows } = await client.query(
    `SELECT id, name, unit, selling_price, gst_percent, is_archived FROM products WHERE id = ANY($1::int[]) AND deleted_at IS NULL`,
    [ids]
  );
  const byId = new Map(rows.map((p) => [p.id, p]));
  const lines = ids.map((id) => {
    const p = byId.get(id);
    if (!p) throw new HttpError(400, 'One of the products no longer exists. Please refresh and try again.', 'VALIDATION');
    if (p.is_archived) throw new HttpError(400, `"${p.name}" is archived and cannot be ordered`, 'VALIDATION');
    const it = merged.get(id);
    return {
      productId: id,
      qty: it.qty,
      rate: allowPriceEdit && it.rate !== undefined ? it.rate : p.selling_price,
      discount: allowPriceEdit && it.discount !== undefined ? it.discount : 0,
      gstPercent: p.gst_percent,
    };
  });
  return calcLines(lines);
}

async function writeItems(client, orderId, calc) {
  await client.query('DELETE FROM order_items WHERE order_id = $1', [orderId]);
  for (const l of calc.lines) {
    await client.query(
      `INSERT INTO order_items (order_id, product_id, qty, rate, discount, gst_percent, line_total) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [orderId, l.productId, l.qty, l.rate, l.discount, l.gstPercent, l.lineTotal]
    );
  }
}

async function loadOrder(id, user) {
  const { rows } = await query(
    `SELECT o.*, p.name AS party_name, p.phone AS party_phone, p.address AS party_address, p.area AS party_area,
            u.name AS agent_name, i.invoice_no
       FROM orders o
       JOIN parties p ON p.id = o.party_id
       LEFT JOIN users u ON u.id = o.agent_id
       LEFT JOIN invoices i ON i.id = o.invoice_id
      WHERE o.id = $1`,
    [id]
  );
  const o = rows[0];
  if (!o || (user.role === 'AGENT' && o.agent_id !== user.id)) throw new HttpError(404, 'Order not found', 'NOT_FOUND');
  const items = await query(
    `SELECT oi.id, oi.product_id, pr.name, pr.unit, pr.sku, oi.qty, oi.rate, oi.discount, oi.gst_percent, oi.line_total, pr.stock_qty,
            (SELECT im.url FROM product_images im WHERE im.product_id = pr.id ORDER BY im.is_primary DESC, im.id LIMIT 1) AS image_url
       FROM order_items oi JOIN products pr ON pr.id = oi.product_id
      WHERE oi.order_id = $1 ORDER BY oi.id`,
    [id]
  );
  return { ...camel(o), items: camelAll(items.rows) };
}

// ─── list ────────────────────────────────────────────────────────────
router.get(
  '/',
  ...protect,
  validate(listSchema, 'query'),
  wrap(async (req, res) => {
    const { status, q, agentId, partyId, page, limit } = req.valid.query;
    const where = [];
    const params = [];
    const add = (sql, v) => {
      params.push(v);
      where.push(sql.replace('?', '$' + params.length));
    };
    if (req.user.role === 'AGENT') add('o.agent_id = ?', req.user.id);
    else if (agentId) add('o.agent_id = ?', agentId);
    if (partyId) add('o.party_id = ?', partyId);
    if (status) add('o.status = ?', status);
    if (q) {
      params.push(`%${escapeLike(q)}%`);
      where.push(`(o.order_no ILIKE $${params.length} OR p.name ILIKE $${params.length})`);
    }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total = (await query(`SELECT count(*)::int AS n FROM orders o JOIN parties p ON p.id = o.party_id ${w}`, params)).rows[0].n;
    const { rows } = await query(
      `SELECT o.id, o.order_no, o.status, o.grand_total, o.created_at, o.invoice_id, p.name AS party_name, u.name AS agent_name, i.invoice_no,
              (SELECT count(*)::int FROM order_items oi WHERE oi.order_id = o.id) AS item_count
         FROM orders o JOIN parties p ON p.id = o.party_id
         LEFT JOIN users u ON u.id = o.agent_id
         LEFT JOIN invoices i ON i.id = o.invoice_id
         ${w} ORDER BY o.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, (page - 1) * limit]
    );
    res.json({ items: camelAll(rows), total, page, limit });
  })
);

// ─── create (agent for own parties; owner for any party) ─────────────
router.post(
  '/',
  ...protect,
  validate(createSchema),
  wrap(async (req, res) => {
    const b = req.valid.body;
    const isAdmin = req.user.role === 'ADMIN';
    const id = await tx(async (client) => {
      const party = (await client.query('SELECT id, assigned_agent_id FROM parties WHERE id = $1 AND deleted_at IS NULL', [b.partyId])).rows[0];
      if (!party) throw new HttpError(404, 'Party not found', 'NOT_FOUND'); // agents can order for any party, not just the ones assigned to them
      const calc = await buildLines(client, b.items, { allowPriceEdit: isAdmin });
      // a number handed to this device in advance is kept (unless it is somehow already taken)
      let orderNo = null;
      if (b.orderNo && (await isReservedFor(req.user.id, 'ORDER', numberPart(b.orderNo)))) {
        const taken = await client.query('SELECT 1 FROM orders WHERE order_no = $1', [b.orderNo]);
        if (!taken.rowCount) orderNo = b.orderNo;
      }
      if (!orderNo) {
        const seq = (await client.query("SELECT nextval('order_no_seq') AS n")).rows[0].n;
        orderNo = 'ORD-' + String(seq).padStart(5, '0');
      }
      const when = sanePastDate(b.createdAt) || new Date();
      const ins = await client.query(
        `INSERT INTO orders (order_no, party_id, agent_id, created_by, notes, discount, subtotal, tax_amount, grand_total, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [orderNo, b.partyId, isAdmin ? party.assigned_agent_id : req.user.id, req.user.id, b.notes, calc.discount, calc.subtotal, calc.tax, calc.total, when]
      );
      await writeItems(client, ins.rows[0].id, calc);
      return ins.rows[0].id;
    });
    res.status(201).json({ order: await loadOrder(id, req.user) });
  })
);

router.get(
  '/:id',
  ...protect,
  validate(idParam, 'params'),
  wrap(async (req, res) => {
    res.json({ order: await loadOrder(req.valid.params.id, req.user) });
  })
);

// ─── owner edits an order that has no invoice yet ────────────────────
router.put(
  '/:id',
  ...adminOnly,
  validate(idParam, 'params'),
  validate(editSchema),
  wrap(async (req, res) => {
    const { id } = req.valid.params;
    await tx(async (client) => {
      const o = (await client.query('SELECT id, status, invoice_id FROM orders WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!o) throw new HttpError(404, 'Order not found', 'NOT_FOUND');
      if (o.invoice_id) throw new HttpError(409, 'This order already has an invoice. Cancel the invoice first to change it.', 'LOCKED');
      if (o.status === 'CANCELLED') throw new HttpError(409, 'A cancelled order cannot be edited', 'LOCKED');
      const calc = await buildLines(client, req.valid.body.items, { allowPriceEdit: true });
      await writeItems(client, id, calc);
      await client.query(
        'UPDATE orders SET notes = $1, discount = $2, subtotal = $3, tax_amount = $4, grand_total = $5, updated_at = now() WHERE id = $6',
        [req.valid.body.notes, calc.discount, calc.subtotal, calc.tax, calc.total, id]
      );
    });
    res.json({ order: await loadOrder(id, req.user) });
  })
);

// ─── status ──────────────────────────────────────────────────────────
router.patch(
  '/:id/status',
  ...protect,
  validate(idParam, 'params'),
  validate(statusSchema),
  wrap(async (req, res) => {
    const { id } = req.valid.params;
    const { status } = req.valid.body;
    const o = (await query('SELECT id, agent_id, status, invoice_id FROM orders WHERE id = $1', [id])).rows[0];
    if (!o || (req.user.role === 'AGENT' && o.agent_id !== req.user.id)) throw new HttpError(404, 'Order not found', 'NOT_FOUND');
    if (req.user.role === 'AGENT') {
      // an agent may only withdraw an order the owner has not started working on
      if (!(status === 'CANCELLED' && o.status === 'PENDING')) throw new HttpError(403, 'Only the owner can change this order', 'FORBIDDEN');
    }
    if (status === 'CANCELLED' && o.invoice_id) {
      throw new HttpError(409, 'This order has an invoice. Cancel the invoice first.', 'LOCKED');
    }
    await query('UPDATE orders SET status = $1, updated_at = now() WHERE id = $2', [status, id]);
    res.json({ order: await loadOrder(id, req.user) });
  })
);

module.exports = router;
