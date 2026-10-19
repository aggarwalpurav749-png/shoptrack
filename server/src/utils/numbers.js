// Number blocks: a device that may be offline asks for a range of order / estimate numbers in advance,
// then numbers its own bills from that range. The server only accepts such a number if it really was handed out to that user.
const { query } = require('../db');

const numberPart = (no) => {
  const m = /(\d+)$/.exec(String(no || ''));
  return m ? Number(m[1]) : null;
};

/** Reserve `count` numbers; returns { from, to }. Runs inside a transaction client. */
async function reserveBlock(client, userId, kind, count) {
  let from;
  if (kind === 'ORDER') {
    await client.query('SELECT pg_advisory_xact_lock(7001)');
    from = Number((await client.query("SELECT nextval('order_no_seq') AS n")).rows[0].n);
    if (count > 1) await client.query("SELECT setval('order_no_seq', $1)", [from + count - 1]);
  } else {
    from = Number((await client.query('UPDATE settings SET next_invoice_no = next_invoice_no + $1 WHERE id = 1 RETURNING next_invoice_no - $1 AS n', [count])).rows[0].n);
  }
  const to = from + count - 1;
  await client.query('INSERT INTO number_blocks (user_id, kind, from_n, to_n) VALUES ($1,$2,$3,$4)', [userId, kind, from, to]);
  return { from, to };
}

/** Was number `n` handed to this user as a block of this kind? */
async function isReservedFor(userId, kind, n) {
  if (!Number.isInteger(n)) return false;
  const { rowCount } = await query('SELECT 1 FROM number_blocks WHERE user_id = $1 AND kind = $2 AND $3 BETWEEN from_n AND to_n LIMIT 1', [userId, kind, n]);
  return rowCount > 0;
}

/** A device-supplied timestamp is trusted only if it is plausible (not in the future, not older than 90 days). */
function sanePastDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const now = Date.now();
  if (d.getTime() > now + 5 * 60 * 1000 || d.getTime() < now - 90 * 86400000) return null;
  return d;
}

module.exports = { numberPart, reserveBlock, isReservedFor, sanePastDate };
