const router = require('express').Router();
const multer = require('multer');
const Papa = require('papaparse');
const XLSX = require('xlsx');
const { z } = require('zod');
const { query, tx } = require('../db');
const { HttpError, wrap, camel, camelAll, escapeLike } = require('../utils/http');
const { validate } = require('../middleware/validate');
const { protect, adminOnly } = require('../middleware/auth');
const { reqText, optText, num, emailField, phoneField, emptyToNull } = require('../utils/fields');
const imp = require('../utils/partyImport');

const MAX_IMPORT_ROWS = 5000;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

const idParam = z.object({ id: z.coerce.number().int().positive() });

const listSchema = z.object({
  q: z.string().trim().max(100).optional(),
  area: z.string().trim().max(100).optional(),
  agentId: z.string().trim().max(20).optional(), // number, or "none"
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const partySchema = z.object({
  name: reqText(150, 'Party name'),
  ownerName: optText(100, 'Owner name'),
  phone: phoneField,
  email: emailField,
  address: optText(300, 'Address'),
  area: optText(100, 'Area'),
  creditLimit: num('Credit limit'),
  openingBalance: num('Opening balance', { min: -1e9 }),
  assignedAgentId: z.preprocess(emptyToNull, z.coerce.number().int().positive().nullable().optional()),
});

// ─── helpers ─────────────────────────────────────────────────────────
const PARTY_SQL = `SELECT p.*, u.name AS agent_name
                     FROM parties p LEFT JOIN users u ON u.id = p.assigned_agent_id`;

async function getParty(id, user) { // eslint-disable-line no-unused-vars
  // agents may open any party (they can take an order for anyone); only the owner can change parties
  const { rows } = await query(`${PARTY_SQL} WHERE p.id = $1 AND p.deleted_at IS NULL`, [id]);
  if (!rows[0]) throw new HttpError(404, 'Party not found', 'NOT_FOUND');
  return camel(rows[0]);
}

async function assertAgent(agentId) {
  if (!agentId) return;
  const { rowCount } = await query(`SELECT 1 FROM users WHERE id = $1 AND role = 'AGENT' AND is_active`, [agentId]);
  if (!rowCount) throw new HttpError(400, 'Selected agent was not found or is disabled', 'VALIDATION', { fields: { assignedAgentId: 'Choose an active agent' } });
}

async function findDuplicate({ phone, excludeId }) {
  const conds = [];
  const params = [];
  if (phone) {
    params.push(phone);
    conds.push(`phone = $${params.length}`);
  }
  if (!conds.length) return null;
  let sql = `SELECT id, name, phone FROM parties WHERE deleted_at IS NULL AND (${conds.join(' OR ')})`;
  if (excludeId) {
    params.push(excludeId);
    sql += ` AND id <> $${params.length}`;
  }
  const { rows } = await query(sql + ' LIMIT 1', params);
  if (!rows[0]) return null;
  return { field: 'phone number', name: rows[0].name };
}

async function throwIfDuplicate(data, excludeId) {
  const dup = await findDuplicate({ phone: data.phone, excludeId });
  if (dup) {
    throw new HttpError(409, `This ${dup.field} already belongs to "${dup.name}"`, 'DUPLICATE', { fields: { phone: `Already used by ${dup.name}` } });
  }
}

// ─── list / areas / template ─────────────────────────────────────────
router.get(
  '/',
  ...protect,
  validate(listSchema, 'query'),
  wrap(async (req, res) => {
    const { q, area, agentId, page, limit } = req.valid.query;
    const where = ['p.deleted_at IS NULL'];
    const params = [];
    const add = (sql, val) => {
      params.push(val);
      where.push(sql.replace('?', '$' + params.length));
    };

    // agents see every party; they can narrow to "my parties" with agentId = their own id
    if (agentId === 'none') where.push('p.assigned_agent_id IS NULL');
    else if (agentId && /^\d+$/.test(agentId)) add('p.assigned_agent_id = ?', Number(agentId));
    if (area) add('p.area = ?', area);
    if (q) {
      params.push(`%${escapeLike(q)}%`);
      const n = '$' + params.length;
      where.push(`(p.name ILIKE ${n} OR p.owner_name ILIKE ${n} OR p.phone ILIKE ${n} OR p.area ILIKE ${n})`);
    }
    const w = where.join(' AND ');

    const total = (await query(`SELECT count(*)::int AS n FROM parties p WHERE ${w}`, params)).rows[0].n;
    const { rows } = await query(
      `${PARTY_SQL} WHERE ${w} ORDER BY lower(p.name), p.id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, (page - 1) * limit]
    );
    res.json({ items: camelAll(rows), total, page, limit });
  })
);

// ids of EVERYTHING matching the current filters (for "select all N parties"), owner only
router.get(
  '/ids',
  ...adminOnly,
  validate(listSchema, 'query'),
  wrap(async (req, res) => {
    const { q, area, agentId } = req.valid.query;
    const where = ['p.deleted_at IS NULL'];
    const params = [];
    if (agentId === 'none') where.push('p.assigned_agent_id IS NULL');
    else if (agentId && /^\d+$/.test(agentId)) {
      params.push(Number(agentId));
      where.push('p.assigned_agent_id = $' + params.length);
    }
    if (area) {
      params.push(area);
      where.push('p.area = $' + params.length);
    }
    if (q) {
      params.push(`%${escapeLike(q)}%`);
      const n = '$' + params.length;
      where.push(`(p.name ILIKE ${n} OR p.owner_name ILIKE ${n} OR p.phone ILIKE ${n} OR p.area ILIKE ${n})`);
    }
    const { rows } = await query(`SELECT p.id FROM parties p WHERE ${where.join(' AND ')} ORDER BY p.id LIMIT 5000`, params);
    res.json({ ids: rows.map((r) => r.id) });
  })
);

// delete many at once (soft delete, same as single delete)
router.post(
  '/bulk-delete',
  ...adminOnly,
  validate(z.object({ ids: z.array(z.coerce.number().int().positive()).min(1).max(5000) })),
  wrap(async (req, res) => {
    const upd = await query(
      'UPDATE parties SET deleted_at = now(), is_active = FALSE, updated_at = now() WHERE id = ANY($1::int[]) AND deleted_at IS NULL RETURNING id',
      [req.valid.body.ids]
    );
    res.json({ ok: true, deleted: upd.rowCount });
  })
);

router.get(
  '/areas',
  ...protect,
  wrap(async (req, res) => {
    const { rows } = await query("SELECT DISTINCT area FROM parties WHERE deleted_at IS NULL AND area IS NOT NULL AND area <> '' ORDER BY area");
    res.json({ items: rows.map((r) => r.area) });
  })
);

router.get('/import/template', ...adminOnly, (req, res) => {
  const csv = Papa.unparse({ fields: imp.TEMPLATE_HEADERS, data: imp.TEMPLATE_ROWS });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="parties-import-template.csv"');
  res.send('﻿' + csv); // BOM so Excel opens it with the right encoding
});

// ─── bulk import ─────────────────────────────────────────────────────
/** Excel / CSV buffer -> { headers, rows } */
function parseSheet(file) {
  const name = (file.originalname || '').toLowerCase();
  let grid;
  try {
    if (name.endsWith('.csv') || name.endsWith('.txt') || file.mimetype === 'text/csv') {
      const text = file.buffer.toString('utf8').replace(/^﻿/, '');
      const parsed = Papa.parse(text, { skipEmptyLines: 'greedy' });
      grid = parsed.data;
    } else if (/\.(xlsx|xls|xlsm)$/.test(name)) {
      const wb = XLSX.read(file.buffer, { type: 'buffer' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: false });
    } else {
      throw new HttpError(400, 'Please upload a .csv or .xlsx file', 'BAD_FILE');
    }
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, 'Could not read this file. Is it a valid CSV / Excel file?', 'BAD_FILE');
  }

  grid = (grid || []).filter((r) => Array.isArray(r) && r.some((c) => String(c == null ? '' : c).trim() !== ''));
  if (grid.length < 2) throw new HttpError(400, 'The file needs a header row and at least one data row', 'BAD_FILE');

  // unique, non-empty header names
  const seen = new Map();
  const headers = grid[0].map((h, i) => {
    let base = String(h == null ? '' : h).trim() || `Column ${i + 1}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return n > 1 ? `${base} (${n})` : base;
  });
  const rows = grid.slice(1).map((r) => {
    const o = {};
    headers.forEach((h, i) => {
      o[h] = r[i] == null ? '' : String(r[i]).trim();
    });
    return o;
  });
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new HttpError(400, `Too many rows (${rows.length}). Please split the file into parts of ${MAX_IMPORT_ROWS} rows or fewer.`, 'TOO_MANY_ROWS');
  }
  return { headers, rows };
}

router.post(
  '/import/preview',
  ...adminOnly,
  upload.single('file'),
  wrap(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'Please choose a file first', 'NO_FILE');
    const { headers, rows } = parseSheet(req.file);
    res.json({
      fileName: req.file.originalname,
      headers,
      rows, // the browser sends these back for validate/commit (keeps the server stateless)
      totalRows: rows.length,
      suggestedMapping: imp.suggestMapping(headers),
      fields: imp.FIELDS.map((f) => ({ key: f.key, label: f.label, required: !!f.required })),
    });
  })
);

const importSchema = z.object({
  rows: z.array(z.record(z.string(), z.any())).min(1, 'No rows to import').max(MAX_IMPORT_ROWS),
  mapping: z.record(z.string(), z.string().nullable()),
  mode: z.enum(['skip', 'update']).default('skip'),
});

async function runAnalysis(body) {
  if (!body.mapping.name) throw new HttpError(400, 'Please choose which column holds the Party name', 'VALIDATION');
  const [parties, agents] = await Promise.all([
    query('SELECT id, name, phone FROM parties WHERE deleted_at IS NULL'),
    query(`SELECT id, name, email FROM users WHERE role = 'AGENT' AND is_active`),
  ]);
  const existing = { byPhone: new Map() };
  for (const p of parties.rows) {
    if (p.phone) existing.byPhone.set(p.phone, p);
  }
  const agentMaps = { byEmail: new Map(), byName: new Map() };
  for (const a of agents.rows) {
    agentMaps.byEmail.set(a.email.toLowerCase(), a.id);
    agentMaps.byName.set(a.name.toLowerCase(), a.id);
  }
  return imp.analyzeRows({ rows: body.rows, mapping: body.mapping, existing, agents: agentMaps, mode: body.mode });
}

const brief = (r) => ({ row: r.rowNumber, status: r.status, name: r.data.name || '', message: r.message });

router.post(
  '/import/validate',
  ...adminOnly,
  validate(importSchema),
  wrap(async (req, res) => {
    const results = await runAnalysis(req.valid.body);
    res.json({ summary: imp.summarize(results), rows: results.map(brief) });
  })
);

const COLS = ['name', 'owner_name', 'phone', 'email', 'address', 'area', 'credit_limit', 'opening_balance', 'current_balance', 'assigned_agent_id'];

router.post(
  '/import/commit',
  ...adminOnly,
  validate(importSchema),
  wrap(async (req, res) => {
    const results = await runAnalysis(req.valid.body); // re-check at the moment of saving
    const toInsert = results.filter((r) => r.status === 'ok');
    const toUpdate = results.filter((r) => r.status === 'update');

    await tx(async (client) => {
      for (let i = 0; i < toInsert.length; i += 200) {
        const chunk = toInsert.slice(i, i + 200);
        const params = [];
        const tuples = chunk.map((r) => {
          const d = r.data;
          const opening = d.openingBalance || 0;
          params.push(d.name, d.ownerName, d.phone, d.email, d.address, d.area, d.creditLimit || 0, opening, opening, d.assignedAgentId);
          const base = params.length - COLS.length;
          return '(' + COLS.map((_, k) => '$' + (base + k + 1)).join(',') + ')';
        });
        await client.query(`INSERT INTO parties (${COLS.join(',')}) VALUES ${tuples.join(',')}`, params);
      }
      // existing parties: only overwrite fields that the file actually filled in
      for (const r of toUpdate) {
        const d = r.data;
        await client.query(
          `UPDATE parties SET
             name = $1,
             owner_name = COALESCE($2, owner_name), phone = COALESCE($3, phone), email = COALESCE($4, email),
             address = COALESCE($5, address), area = COALESCE($6, area),
             credit_limit = COALESCE($7, credit_limit),
             assigned_agent_id = COALESCE($8, assigned_agent_id),
             updated_at = now()
           WHERE id = $9`,
          [d.name, d.ownerName, d.phone, d.email, d.address, d.area, d.creditLimit, d.assignedAgentId, r.matchId]
        );
      }
    });

    const summary = imp.summarize(results);
    res.json({
      inserted: toInsert.length,
      updated: toUpdate.length,
      skippedDuplicates: summary.duplicate,
      failed: summary.error,
      // everything that was NOT a clean insert/update, ready for the "error report" download
      issues: results.filter((r) => r.status === 'error' || r.status === 'duplicate' || r.warnings.length).map(brief),
    });
  })
);

// ─── single party CRUD ───────────────────────────────────────────────
router.get(
  '/:id',
  ...protect,
  validate(idParam, 'params'),
  wrap(async (req, res) => {
    res.json({ party: await getParty(req.valid.params.id, req.user) });
  })
);

router.post(
  '/',
  ...adminOnly,
  validate(partySchema),
  wrap(async (req, res) => {
    const b = req.valid.body;
    await assertAgent(b.assignedAgentId);
    await throwIfDuplicate(b);
    const { rows } = await query(
      `INSERT INTO parties (name, owner_name, phone, email, address, area, credit_limit, opening_balance, current_balance, assigned_agent_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9) RETURNING id`,
      [b.name, b.ownerName, b.phone, b.email, b.address, b.area, b.creditLimit, b.openingBalance, b.assignedAgentId || null]
    );
    res.status(201).json({ party: await getParty(rows[0].id, req.user) });
  })
);

router.put(
  '/:id',
  ...adminOnly,
  validate(idParam, 'params'),
  validate(partySchema),
  wrap(async (req, res) => {
    const { id } = req.valid.params;
    const b = req.valid.body;
    await assertAgent(b.assignedAgentId);
    await throwIfDuplicate(b, id);
    const upd = await query(
      `UPDATE parties SET name=$1, owner_name=$2, phone=$3, email=$4, address=$5, area=$6,
              credit_limit=$7,
              current_balance = current_balance + ($8 - opening_balance),  -- keep ledger consistent if opening balance is corrected
              opening_balance=$8, assigned_agent_id=$9, updated_at=now()
        WHERE id=$10 AND deleted_at IS NULL RETURNING id`,
      [b.name, b.ownerName, b.phone, b.email, b.address, b.area, b.creditLimit, b.openingBalance, b.assignedAgentId || null, id]
    );
    if (!upd.rowCount) throw new HttpError(404, 'Party not found', 'NOT_FOUND');
    res.json({ party: await getParty(id, req.user) });
  })
);

router.delete(
  '/:id',
  ...adminOnly,
  validate(idParam, 'params'),
  wrap(async (req, res) => {
    // soft delete: old orders / invoices keep pointing at the party
    const upd = await query(
      'UPDATE parties SET deleted_at = now(), is_active = FALSE, updated_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id',
      [req.valid.params.id]
    );
    if (!upd.rowCount) throw new HttpError(404, 'Party not found', 'NOT_FOUND');
    res.json({ ok: true });
  })
);

module.exports = router;
