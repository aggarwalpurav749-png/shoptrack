// Invoices are created by the owner from an agent's order. Numbers come from Settings (prefix + counter).
const router = require('express').Router();
const { z } = require('zod');
const { query, tx } = require('../db');
const { HttpError, wrap, camel, camelAll, escapeLike } = require('../utils/http');
const { validate } = require('../middleware/validate');
const { adminOnly } = require('../middleware/auth');
const XLSX = require('xlsx');
const cfg = require('../config');
const { calcLines, splitTax, roundTotal } = require('../utils/money');
const { isReservedFor, sanePastDate } = require('../utils/numbers');

router.use(...adminOnly);

const idParam = z.object({ id: z.coerce.number().int().positive() });
const orderParam = z.object({ orderId: z.coerce.number().int().positive() });
// the offline apps send the number they printed on the estimate and the time it was made
const fromOrderBody = z.object({ number: z.coerce.number().int().positive().optional(), createdAt: z.string().max(40).optional() }).default({});
const listSchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['UNPAID', 'PARTIAL', 'PAID', 'CANCELLED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

router.get(
  '/',
  validate(listSchema, 'query'),
  wrap(async (req, res) => {
    const { q, status, page, limit } = req.valid.query;
    const where = [];
    const params = [];
    if (status) {
      params.push(status);
      where.push(`i.status = $${params.length}`);
    }
    if (q) {
      params.push(`%${escapeLike(q)}%`);
      where.push(`(i.invoice_no ILIKE $${params.length} OR p.name ILIKE $${params.length})`);
    }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total = (await query(`SELECT count(*)::int AS n FROM invoices i JOIN parties p ON p.id = i.party_id ${w}`, params)).rows[0].n;
    const { rows } = await query(
      `SELECT i.id, i.invoice_no, i.invoice_date, i.grand_total, i.amount_paid, i.status, p.name AS party_name,
              (SELECT o.order_no FROM orders o WHERE o.invoice_id = i.id LIMIT 1) AS order_no
         FROM invoices i JOIN parties p ON p.id = i.party_id ${w}
        ORDER BY i.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, (page - 1) * limit]
    );
    res.json({ items: camelAll(rows), total, page, limit });
  })
);

async function loadInvoice(id) {
  const inv = (
    await query(
      `SELECT i.*, p.name AS party_name, p.owner_name AS party_owner, p.phone AS party_phone, p.address AS party_address, p.area AS party_area,
              (SELECT o.order_no FROM orders o WHERE o.invoice_id = i.id LIMIT 1) AS order_no,
              (SELECT o.id FROM orders o WHERE o.invoice_id = i.id LIMIT 1) AS order_id
         FROM invoices i JOIN parties p ON p.id = i.party_id WHERE i.id = $1`,
      [id]
    )
  ).rows[0];
  if (!inv) throw new HttpError(404, 'Invoice not found', 'NOT_FOUND');
  const items = await query('SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY id', [id]);
  const shop = (await query('SELECT shop_name, logo_url, address, phone, email, bank_name, account_no, ifsc, upi_id, terms FROM settings WHERE id = 1')).rows[0];
  return { invoice: camel(inv), items: camelAll(items.rows), shop: camel(shop) };
}

// ─── Excel export (day / week / month, any date range) ───────────────
const exportSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a start date'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose an end date'),
  includeCancelled: z.enum(['true', 'false']).default('false'),
});

router.get(
  '/export',
  validate(exportSchema, 'query'),
  wrap(async (req, res) => {
    const { from, to, includeCancelled } = req.valid.query;
    if (from > to) throw new HttpError(400, 'Start date must be before the end date', 'VALIDATION');
    const params = [cfg.timezone, from, to];
    // dates are compared in the shop's timezone (Asia/Kolkata by default), not in server time
    const where =
      '(i.invoice_date AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date' + (includeCancelled === 'true' ? '' : " AND i.status <> 'CANCELLED'");

    const heads = await query(
      `SELECT i.invoice_no, to_char(i.invoice_date AT TIME ZONE $1, 'YYYY-MM-DD') AS bill_date, to_char(i.invoice_date AT TIME ZONE $1, 'HH24:MI') AS bill_time,
              p.name AS party_name, p.owner_name, p.phone, p.area, i.subtotal, i.discount, (i.cgst + i.sgst + i.igst) AS gst, i.round_off, i.grand_total, i.status,
              (SELECT o.order_no FROM orders o WHERE o.invoice_id = i.id LIMIT 1) AS order_no,
              (SELECT u.name FROM orders o JOIN users u ON u.id = o.agent_id WHERE o.invoice_id = i.id LIMIT 1) AS agent_name
         FROM invoices i JOIN parties p ON p.id = i.party_id
        WHERE ${where} ORDER BY i.invoice_date, i.id LIMIT 20000`,
      params
    );
    const lines = await query(
      `SELECT i.invoice_no, to_char(i.invoice_date AT TIME ZONE $1, 'YYYY-MM-DD') AS bill_date, p.name AS party_name,
              ii.name, pr.sku, ii.hsn, ii.unit, ii.qty, ii.rate, ii.discount, ii.taxable, ii.gst_percent, ii.tax, ii.line_total
         FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id JOIN parties p ON p.id = i.party_id
         LEFT JOIN products pr ON pr.id = ii.product_id
        WHERE ${where} ORDER BY i.invoice_date, i.id, ii.id LIMIT 100000`,
      params
    );

    const estimates = heads.rows.map((r) => ({
      'Estimate No': r.invoice_no,
      Date: r.bill_date,
      Time: r.bill_time,
      Party: r.party_name,
      Owner: r.owner_name || '',
      Phone: r.phone || '',
      Area: r.area || '',
      Agent: r.agent_name || '',
      'Order No': r.order_no || '',
      'Taxable Amount': r.subtotal,
      Discount: r.discount,
      'GST Amount': r.gst,
      'Round Off': r.round_off,
      Total: r.grand_total,
      Status: r.status,
    }));
    const items = lines.rows.map((r) => ({
      'Estimate No': r.invoice_no,
      Date: r.bill_date,
      Party: r.party_name,
      Item: r.name,
      SKU: r.sku || '',
      HSN: r.hsn || '',
      Unit: r.unit || '',
      Qty: r.qty,
      Rate: r.rate,
      Discount: r.discount,
      'Taxable Amount': r.taxable,
      'GST %': r.gst_percent,
      'GST Amount': r.tax,
      'Line Total': r.line_total,
    }));
    const live = heads.rows.filter((r) => r.status !== 'CANCELLED');
    const sum = (k) => Math.round(live.reduce((a, r) => a + Number(r[k]), 0) * 100) / 100;
    const summary = [
      { Item: 'From', Value: from },
      { Item: 'To', Value: to },
      { Item: 'Number of estimates (excluding cancelled)', Value: live.length },
      { Item: 'Taxable Amount', Value: sum('subtotal') },
      { Item: 'GST Amount', Value: sum('gst') },
      { Item: 'Total', Value: sum('grand_total') },
    ];

    const sheet = (rows, header, widths) => {
      const ws = XLSX.utils.json_to_sheet(rows, { header });
      ws['!cols'] = widths.map((wch) => ({ wch }));
      return ws;
    };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet(estimates, ['Estimate No', 'Date', 'Time', 'Party', 'Owner', 'Phone', 'Area', 'Agent', 'Order No', 'Taxable Amount', 'Discount', 'GST Amount', 'Round Off', 'Total', 'Status'], [14, 12, 8, 28, 18, 13, 16, 16, 12, 14, 10, 12, 10, 12, 11]), 'Estimates');
    XLSX.utils.book_append_sheet(wb, sheet(items, ['Estimate No', 'Date', 'Party', 'Item', 'SKU', 'HSN', 'Unit', 'Qty', 'Rate', 'Discount', 'Taxable Amount', 'GST %', 'GST Amount', 'Line Total'], [14, 12, 28, 34, 12, 10, 8, 8, 10, 10, 14, 8, 12, 12]), 'Items');
    XLSX.utils.book_append_sheet(wb, sheet(summary, ['Item', 'Value'], [42, 16]), 'Summary');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="estimates_${from}_to_${to}.xlsx"`);
    res.send(buf);
  })
);

router.get(
  '/:id',
  validate(idParam, 'params'),
  wrap(async (req, res) => {
    res.json(await loadInvoice(req.valid.params.id));
  })
);

// Create the invoice from an order (one order -> one invoice).
router.post(
  '/from-order/:orderId',
  validate(orderParam, 'params'),
  validate(fromOrderBody),
  wrap(async (req, res) => {
    const { orderId } = req.valid.params;
    const wanted = req.valid.body || {};
    const result = await tx(async (client) => {
      const order = (await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId])).rows[0];
      if (!order) throw new HttpError(404, 'Order not found', 'NOT_FOUND');
      if (order.invoice_id) throw new HttpError(409, 'This order already has an invoice', 'DUPLICATE');
      if (order.status === 'CANCELLED') throw new HttpError(409, 'A cancelled order cannot be invoiced', 'LOCKED');

      const items = (
        await client.query(
          `SELECT oi.product_id, oi.qty, oi.rate, oi.discount, oi.gst_percent, pr.name, pr.unit, pr.hsn
             FROM order_items oi JOIN products pr ON pr.id = oi.product_id WHERE oi.order_id = $1 ORDER BY oi.id`,
          [orderId]
        )
      ).rows;
      if (!items.length) throw new HttpError(400, 'This order has no items', 'VALIDATION');

      const calc = calcLines(items.map((i) => ({ ...i, gstPercent: i.gst_percent })));
      const shop = (await client.query('SELECT invoice_prefix FROM settings WHERE id = 1 FOR UPDATE')).rows[0];
      const taxSplit = splitTax(calc.tax, false) // estimates: GST is shown as one amount, no state-wise split;
      const { grand, roundOff } = roundTotal(calc.total);

      let counter = null;
      if (wanted.number && (await isReservedFor(req.user.id, 'INVOICE', wanted.number))) {
        const dup = await client.query('SELECT 1 FROM invoices WHERE invoice_no = $1', [`${shop.invoice_prefix || 'EST'}-${String(wanted.number).padStart(4, '0')}`]);
        if (!dup.rowCount) counter = wanted.number;
      }
      if (!counter) counter = (await client.query('UPDATE settings SET next_invoice_no = next_invoice_no + 1 WHERE id = 1 RETURNING next_invoice_no - 1 AS n')).rows[0].n;
      const invoiceNo = `${shop.invoice_prefix || 'EST'}-${String(counter).padStart(4, '0')}`;
      const when = sanePastDate(wanted.createdAt) || new Date();

      const inv = (
        await client.query(
          `INSERT INTO invoices (invoice_no, party_id, created_by, subtotal, discount, cgst, sgst, igst, round_off, grand_total, terms, invoice_date)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,(SELECT terms FROM settings WHERE id = 1),$11) RETURNING id`,
          [invoiceNo, order.party_id, req.user.id, calc.subtotal, calc.discount, taxSplit.cgst, taxSplit.sgst, taxSplit.igst, roundOff, grand, when]
        )
      ).rows[0];

      const lowStock = [];
      for (const l of calc.lines) {
        await client.query(
          `INSERT INTO invoice_items (invoice_id, product_id, name, hsn, unit, qty, rate, discount, gst_percent, taxable, tax, line_total)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [inv.id, l.product_id, l.name, l.hsn, l.unit, l.qty, l.rate, l.discount, l.gstPercent, l.taxable, l.tax, l.lineTotal]
        );
        const st = (await client.query('UPDATE products SET stock_qty = stock_qty - $1, updated_at = now() WHERE id = $2 RETURNING name, stock_qty', [l.qty, l.product_id])).rows[0];
        if (st && st.stock_qty < 0) lowStock.push(st.name);
      }
      await client.query('UPDATE parties SET current_balance = current_balance + $1, updated_at = now() WHERE id = $2', [grand, order.party_id]);
      await client.query(
        `UPDATE orders SET invoice_id = $1, status = CASE WHEN status = 'PENDING' THEN 'CONFIRMED' ELSE status END, updated_at = now() WHERE id = $2`,
        [inv.id, orderId]
      );
      return { id: inv.id, invoiceNo, negativeStock: lowStock };
    });
    res.status(201).json(result);
  })
);

// Cancel an invoice: stock and the party's balance go back, the order becomes editable again.
router.post(
  '/:id/cancel',
  validate(idParam, 'params'),
  wrap(async (req, res) => {
    const { id } = req.valid.params;
    await tx(async (client) => {
      const inv = (await client.query('SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!inv) throw new HttpError(404, 'Invoice not found', 'NOT_FOUND');
      if (inv.status === 'CANCELLED') throw new HttpError(409, 'Invoice is already cancelled', 'LOCKED');
      if (Number(inv.amount_paid) > 0) throw new HttpError(409, 'Payments are recorded on this invoice, so it cannot be cancelled', 'LOCKED');
      const items = (await client.query('SELECT product_id, qty FROM invoice_items WHERE invoice_id = $1', [id])).rows;
      for (const it of items) {
        if (it.product_id) await client.query('UPDATE products SET stock_qty = stock_qty + $1, updated_at = now() WHERE id = $2', [it.qty, it.product_id]);
      }
      await client.query('UPDATE parties SET current_balance = current_balance - $1, updated_at = now() WHERE id = $2', [inv.grand_total, inv.party_id]);
      await client.query("UPDATE invoices SET status = 'CANCELLED', updated_at = now() WHERE id = $1", [id]);
      await client.query("UPDATE orders SET invoice_id = NULL, status = 'PENDING', updated_at = now() WHERE invoice_id = $1", [id]);
    });
    res.json(await loadInvoice(id));
  })
);

module.exports = router;
