const router = require('express').Router();
const { query } = require('../db');
const { wrap, camelAll } = require('../utils/http');
const { protect } = require('../middleware/auth');
const cfg = require('../config');

// Phase 2 adds sales / orders / dues here; Phase 3 adds live agent status.
router.get(
  '/',
  ...protect,
  wrap(async (req, res) => {
    if (req.user.role === 'AGENT') {
      const [parties, products, orders] = await Promise.all([
        query('SELECT count(*)::int AS n FROM parties WHERE deleted_at IS NULL AND assigned_agent_id = $1', [req.user.id]),
        query('SELECT count(*)::int AS n FROM products WHERE deleted_at IS NULL AND is_archived = FALSE'),
        query(
          `SELECT count(*) FILTER (WHERE created_at >= date_trunc('day', now() AT TIME ZONE $2) AT TIME ZONE $2)::int AS today,
                  count(*) FILTER (WHERE status = 'PENDING')::int AS pending,
                  COALESCE(sum(grand_total) FILTER (WHERE created_at >= date_trunc('day', now() AT TIME ZONE $2) AT TIME ZONE $2 AND status <> 'CANCELLED'), 0) AS today_value
             FROM orders WHERE agent_id = $1`,
          [req.user.id, cfg.timezone]
        ),
      ]);
      return res.json({
        role: 'AGENT',
        myParties: parties.rows[0].n,
        products: products.rows[0].n,
        ordersToday: orders.rows[0].today,
        ordersPending: orders.rows[0].pending,
        ordersTodayValue: orders.rows[0].today_value,
      });
    }

    const [parties, products, agents, stock, lowItems, ord, recent, duty] = await Promise.all([
      query('SELECT count(*)::int AS n FROM parties WHERE deleted_at IS NULL'),
      query('SELECT count(*)::int AS n FROM products WHERE deleted_at IS NULL AND is_archived = FALSE'),
      query("SELECT count(*)::int AS n FROM users WHERE role = 'AGENT' AND is_active"),
      query(
        `SELECT count(*) FILTER (WHERE stock_qty <= 0)::int AS out_count,
                count(*) FILTER (WHERE stock_qty > 0 AND stock_qty <= low_stock_level)::int AS low_count
           FROM products WHERE deleted_at IS NULL AND is_archived = FALSE`
      ),
      query(
        `SELECT id, name, unit, stock_qty, low_stock_level FROM products
          WHERE deleted_at IS NULL AND is_archived = FALSE AND stock_qty <= low_stock_level
          ORDER BY stock_qty ASC, lower(name) LIMIT 6`
      ),
      query(
        `SELECT count(*) FILTER (WHERE status = 'PENDING')::int AS pending,
                count(*) FILTER (WHERE status NOT IN ('CANCELLED') AND invoice_id IS NULL)::int AS to_invoice
           FROM orders`
      ),
      query(
        `SELECT o.id, o.order_no, o.status, o.grand_total, o.created_at, p.name AS party_name, u.name AS agent_name
           FROM orders o JOIN parties p ON p.id = o.party_id LEFT JOIN users u ON u.id = o.agent_id
          ORDER BY o.id DESC LIMIT 6`
      ),
      query(
        `SELECT count(*) FILTER (WHERE on_duty)::int AS on_duty FROM users WHERE role = 'AGENT' AND is_active`
      ),
    ]);
    res.json({
      role: 'ADMIN',
      parties: parties.rows[0].n,
      products: products.rows[0].n,
      agents: agents.rows[0].n,
      outOfStock: stock.rows[0].out_count,
      lowStock: stock.rows[0].low_count,
      lowStockItems: camelAll(lowItems.rows),
      ordersPending: ord.rows[0].pending,
      ordersToInvoice: ord.rows[0].to_invoice,
      recentOrders: camelAll(recent.rows),
      agentsOnDuty: duty.rows[0].on_duty,
    });
  })
);

module.exports = router;
