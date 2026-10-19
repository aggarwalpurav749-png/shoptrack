// Demo data: 3 agents, 20 products, 10 parties. Safe to run more than once (skips what exists).
// Usage:  npm run seed        (or set SEED_DEMO=true and start the server)
const { query, tx, migrate, pool } = require('../src/db');
const { hashPassword } = require('../src/utils/password');

const AGENTS = [
  { email: 'ravi@shop.com', name: 'Ravi Kumar', phone: '9123456781', start: '09:00', end: '18:00' },
  { email: 'suresh@shop.com', name: 'Suresh Patil', phone: '9123456782', start: '09:30', end: '18:30' },
  { email: 'mohan@shop.com', name: 'Mohan Singh', phone: '9123456783', start: '09:00', end: '17:00' },
];

// [name, sku, category, brand, unit, mrp, selling, cost, gst, hsn, stock, lowLevel]
const PRODUCTS = [
  ['Tata Salt 1kg', 'SKU001', 'Groceries', 'Tata', 'PKT', 25, 22, 18, 0, '2501', 500, 50],
  ['Amul Butter 100g', 'SKU002', 'Dairy', 'Amul', 'PCS', 55, 50, 42, 12, '0405', 200, 20],
  ['Parle-G Biscuit 80g', 'SKU003', 'Snacks', 'Parle', 'PKT', 10, 9, 7, 18, '1905', 1000, 100],
  ['Surf Excel 1kg', 'SKU004', 'Household', 'HUL', 'PKT', 110, 100, 85, 18, '3402', 300, 30],
  ['Tropicana Orange 1L', 'SKU005', 'Beverages', 'Tropicana', 'LTR', 99, 88, 72, 12, '2009', 150, 15],
  ['Maggi Noodles 70g', 'SKU006', 'Snacks', 'Nestle', 'PKT', 14, 13, 10, 18, '1902', 800, 80],
  ['Fortune Sunflower Oil 1L', 'SKU007', 'Groceries', 'Fortune', 'LTR', 160, 145, 130, 5, '1512', 250, 25],
  ['Vim Dishwash Bar 200g', 'SKU008', 'Household', 'HUL', 'PCS', 20, 18, 14, 18, '3402', 400, 40],
  ['Amul Gold Milk 500ml', 'SKU009', 'Dairy', 'Amul', 'PKT', 28, 26, 22, 0, '0401', 300, 30],
  ['Hajmola Candy 100s', 'SKU010', 'Snacks', 'Dabur', 'BOX', 30, 27, 22, 18, '1704', 200, 20],
  ['Aashirvaad Atta 5kg', 'SKU011', 'Groceries', 'ITC', 'PKT', 250, 230, 200, 0, '1101', 100, 10],
  ['Kissan Jam Mixed Fruit 500g', 'SKU012', 'Groceries', 'HUL', 'PCS', 130, 118, 98, 12, '2007', 80, 8],
  ['Dettol Soap 75g', 'SKU013', 'Household', 'Reckitt', 'PCS', 35, 31, 25, 18, '3401', 350, 35],
  ['Good Day Cashew Biscuit', 'SKU014', 'Snacks', 'Britannia', 'PKT', 30, 27, 22, 18, '1905', 600, 60],
  ['Red Label Tea 500g', 'SKU015', 'Beverages', 'Brooke Bond', 'PKT', 190, 172, 145, 5, '0902', 120, 12],
  ['Nescafe Classic 50g', 'SKU016', 'Beverages', 'Nestle', 'PCS', 160, 145, 120, 12, '2101', 90, 9],
  ['Colgate MaxFresh 150g', 'SKU017', 'Household', 'Colgate', 'PCS', 72, 65, 52, 18, '3306', 280, 28],
  ["Lay's Classic Salted 26g", 'SKU018', 'Snacks', 'Frito-Lay', 'PKT', 20, 18, 14, 12, '2005', 500, 50],
  ['Horlicks Classic 500g', 'SKU019', 'Beverages', 'GSK', 'PCS', 280, 255, 215, 18, '1901', 60, 6],
  ['Harpic Toilet Cleaner 500ml', 'SKU020', 'Household', 'Reckitt', 'PCS', 85, 76, 62, 18, '3808', 5, 10], // low stock on purpose, to show the badge
];

// [name, owner, phone, address, area, creditLimit, opening, agentIndex]
const PARTIES = [
  ['Shree Ram General Store', 'Rakesh Gupta', '9011223344', '45 MG Road', 'Civil Lines', 50000, 5000, 0],
  ['Jai Hanuman Kirana', 'Vijay Sharma', '9022334455', '12 Station Road', 'Sitabuldi', 30000, 2500, 0],
  ['Mahalaxmi Mart', 'Anita Patel', '9033445566', '78 Wardha Road', 'Dharampeth', 75000, 0, 1],
  ['Ganesh Provision', 'Ganesh Rao', '9044556677', '33 Itwari Chowk', 'Itwari', 25000, 3200, 1],
  ['Shiv Shakti Super Store', 'Prakash Deshmukh', '9055667788', '91 Kamptee Road', 'Kamptee', 60000, 1500, 1],
  ['Durga General Merchants', 'Sunil Wagh', '9066778899', '5 Sadar Bazar', 'Sadar', 40000, 800, 2],
  ['Om Sai Kirana Store', 'Santosh Meshram', '9077889900', '22 Hingna Road', 'Hingna', 20000, 0, 2],
  ['Balaji Super Mart', 'Nitin Joshi', '9088990011', '14 Ramdaspeth Main Road', 'Ramdaspeth', 45000, 1200, 0],
  ['Krishna Stores', 'Mahesh Kale', '9099001122', '7 Manewada Chowk', 'Manewada', 15000, 0, 2],
  ['Laxmi Trading Co', 'Deepak Agrawal', '9100112233', '60 Cotton Market', 'Itwari', 90000, 6400, null],
];

async function seedDemo() {
  const pwHash = await hashPassword('Agent@123');
  const agentIds = [];
  for (const a of AGENTS) {
    const found = await query('SELECT id FROM users WHERE lower(email) = lower($1)', [a.email]);
    if (found.rowCount) {
      agentIds.push(found.rows[0].id);
      continue;
    }
    const ins = await query(
      `INSERT INTO users (email, password_hash, name, phone, role, must_change_password, work_start, work_end)
       VALUES ($1, $2, $3, $4, 'AGENT', TRUE, $5, $6) RETURNING id`,
      [a.email, pwHash, a.name, a.phone, a.start, a.end]
    );
    agentIds.push(ins.rows[0].id);
  }

  let newProducts = 0;
  let newParties = 0;
  await tx(async (c) => {
    for (const p of PRODUCTS) {
      const ex = await c.query('SELECT 1 FROM products WHERE lower(sku) = lower($1) AND deleted_at IS NULL', [p[1]]);
      if (ex.rowCount) continue;
      await c.query(
        `INSERT INTO products (name, sku, category, brand, unit, mrp, selling_price, cost_price, gst_percent, hsn, stock_qty, low_stock_level)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        p
      );
      newProducts++;
    }
    for (const p of PARTIES) {
      const ex = await c.query('SELECT 1 FROM parties WHERE phone = $1 AND deleted_at IS NULL', [p[2]]);
      if (ex.rowCount) continue;
      await c.query(
        `INSERT INTO parties (name, owner_name, phone, address, area, credit_limit, opening_balance, current_balance, assigned_agent_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8)`,
        [p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7] === null ? null : agentIds[p[7]]]
      );
      newParties++;
    }
  });
  console.log(`[seed] demo data ready (new: ${newProducts} products, ${newParties} parties). Agent password: Agent@123`);
}

module.exports = { seedDemo };

if (require.main === module) {
  (async () => {
    await migrate();
    await query('INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
    await seedDemo();
  })()
    .catch((e) => {
      console.error('Seed failed:', e.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
